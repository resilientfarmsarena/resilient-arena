/* The application form on a job page, /hiring/<name>.

   This page holds no credentials. It posts the answers to /api/apply,
   and the server maps them onto Airtable field IDs using the token in
   its AIRTABLE_TOKEN environment variable. See api/apply.js. */
(function () {
  "use strict";

  var ENDPOINT = "/api/apply";
  /* Must match RESUME_MAX_BYTES in api/apply.js. The resume travels with
     the answers and goes straight into the candidate's Airtable row, so
     the ceiling is what a serverless request body can carry. */
  var MAX_FILE_BYTES = 3 * 1024 * 1024;

  var form = document.getElementById("applyForm");
  if (!form) return;
  var msg  = document.getElementById("formMsg");
  var btn  = document.getElementById("submitBtn");
  var done = document.getElementById("done");

  /* The Apply bar that follows a phone down the page has done its job
     once the form is on screen, and would only sit on top of the
     questions from there on. */
  (function () {
    var bar = document.getElementById("applybar");
    var sheet = document.getElementById("apply");
    if (!bar || !sheet || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (entries) {
      var e = entries[0];
      /* Away while the form is in view, and also once it has scrolled
         off the top, which only happens at the very end of the page. */
      bar.classList.toggle("is-away", e.isIntersecting || e.boundingClientRect.top < 0);
    }).observe(sheet);
  })();

  /* Days: cap the selection at two */
  (function () {
    var days = Array.prototype.slice.call(
      document.querySelectorAll('input[name="availability"]'));
    function sync() {
      var picked = days.filter(function (d) { return d.checked; }).length;
      days.forEach(function (d) { d.disabled = (!d.checked && picked >= 2); });
    }
    days.forEach(function (d) { d.addEventListener("change", sync); });
    sync();
  })();

  /* "Something else" chips reveal a write-in box */
  [["skillsOther", "skillsOtherWrap", "otherSkills"],
   ["equipOther", "equipOtherWrap", "otherEquipment"]].forEach(function (pair) {
    var box = document.getElementById(pair[0]);
    var wrap = document.getElementById(pair[1]);
    var input = document.getElementById(pair[2]);
    if (!box) return;
    box.addEventListener("change", function () {
      wrap.hidden = !box.checked;
      if (box.checked) { input.focus(); } else { input.value = ""; }
    });
  });

  /* phone formats itself as (325) 555-0134 */
  var phoneInput = document.getElementById("phone");
  phoneInput.addEventListener("input", function () {
    var d = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    var out = "";
    if (d.length === 0) out = "";
    else if (d.length < 4) out = "(" + d;
    else if (d.length < 7) out = "(" + d.slice(0,3) + ") " + d.slice(3);
    else out = "(" + d.slice(0,3) + ") " + d.slice(3,6) + "-" + d.slice(6);
    phoneInput.value = out;
  });

  /* pay: digits and one decimal point only */
  var rateInput = document.getElementById("rate");
  rateInput.addEventListener("input", function () {
    var v = rateInput.value.replace(/[^0-9.]/g, "");
    var dot = v.indexOf(".");
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
      v = v.slice(0, dot + 3);
    }
    if (v !== rateInput.value) rateInput.value = v;
  });

  /* years around horses: whole numbers only */
  var yrs = document.getElementById("horseYears");
  yrs.addEventListener("input", function () {
    var v = yrs.value.replace(/[^0-9]/g, "").slice(0, 2);
    if (v !== yrs.value) yrs.value = v;
  });

  /* start date cannot be in the past */
  var startEl = document.getElementById("startDate");
  startEl.min = new Date().toISOString().slice(0, 10);

  function say(text) {
    msg.textContent = text;
    msg.hidden = false;
  }

  /* A question marked as missing stops being marked the moment it is
     answered, rather than staying red until the next try at sending. */
  function unmark(e) {
    var holder = e.target.closest(".error");
    if (holder) holder.classList.remove("error");
  }
  form.addEventListener("input", unmark);
  form.addEventListener("change", unmark);

  function checkedValues(name) {
    return Array.prototype.slice
      .call(form.querySelectorAll('input[name="' + name + '"]:checked'))
      .map(function (el) { return el.value; })
      .filter(function (v) { return v !== "Other"; });
  }

  function readFileAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var r = String(reader.result);
        resolve(r.slice(r.indexOf(",") + 1));
      };
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.readAsDataURL(blob);
    });
  }

  function isImage(file) { return /^image\//i.test(file.type || ""); }

  /* Decode to something canvas can draw. createImageBitmap honours the
     EXIF rotation a phone writes, so a portrait photo does not arrive on
     its side. Falls back to an <img> where that is unavailable, and gives
     up quietly on formats the browser cannot read (Chrome and HEIC). */
  function decodeImage(file) {
    if (window.createImageBitmap) {
      try {
        return createImageBitmap(file, { imageOrientation: "from-image" })
          .catch(function () { return decodeViaImg(file); });
      } catch (e) { /* older signature, fall through */ }
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      img.src = url;
    });
  }

  /* A photo of a printed resume off a phone is routinely 4 to 8 MB, well
     past what the form can carry. Redraw it smaller and re-encode as JPEG
     until it fits, stepping the long edge down first and quality second so
     the text stays readable. Documents are never touched. */
  function shrinkImage(file, maxBytes) {
    var EDGES = [2200, 1700, 1300, 1000];
    var QUALITIES = [0.82, 0.68, 0.55];

    return decodeImage(file).then(function (src) {
      var w0 = src.width, h0 = src.height;
      if (!w0 || !h0) return null;

      return new Promise(function (resolve) {
        var i = 0;
        (function attempt() {
          if (i >= EDGES.length * QUALITIES.length) { resolve(null); return; }
          var edge = EDGES[Math.floor(i / QUALITIES.length)];
          var quality = QUALITIES[i % QUALITIES.length];
          i++;

          var scale = Math.min(1, edge / Math.max(w0, h0));
          var w = Math.max(1, Math.round(w0 * scale));
          var h = Math.max(1, Math.round(h0 * scale));

          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          /* White behind it: a transparent PNG would otherwise flatten to
             black once it becomes a JPEG. */
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(src, 0, 0, w, h);

          canvas.toBlob(function (blob) {
            if (!blob) { resolve(null); return; }
            if (blob.size <= maxBytes) { resolve(blob); return; }
            attempt();
          }, "image/jpeg", quality);
        })();
      });
    }).catch(function () { return null; });
  }

  /* Returns the resume payload, shrinking a photo first if it needs it. */
  function prepareResume(file, maxBytes) {
    var pack = function (blob, filename, contentType) {
      return readFileAsBase64(blob).then(function (b64) {
        return { filename: filename, contentType: contentType, data: b64 };
      });
    };

    if (!isImage(file) || file.size <= maxBytes) {
      return pack(file, file.name, file.type || "application/octet-stream");
    }

    return shrinkImage(file, maxBytes).then(function (smaller) {
      if (!smaller) return null;                       // could not read it
      var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return pack(smaller, name, "image/jpeg");
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.hidden = true;

    var get = function (id) { var el = document.getElementById(id); return el ? (el.value || "").trim() : ""; };

    var p = {
      /* Which job this is for. The server links the application to it. */
      job: form.getAttribute("data-job") || "",
      firstName: get("firstName"),
      lastName: get("lastName"),
      phone: get("phone"),
      okToText: document.getElementById("okToText").checked,
      email: get("email"),
      city: get("city"),
      roleFit: get("roleFit"),
      desiredHours: get("desiredHours"),
      positionInterest: checkedValues("positionInterest"),
      availability: checkedValues("availability"),
      startDate: get("startDate"),
      groundsSkills: checkedValues("groundsSkills"),
      otherSkills: get("otherSkills"),
      horseSkills: checkedValues("horseSkills"),
      equipment: checkedValues("equipment"),
      otherEquipment: get("otherEquipment"),
      applicator: get("applicator"),
      horseExperience: get("horseExperience"),
      horseYears: get("horseYears"),
      license: form.license.checked,
      transportation: form.transportation.checked,
      workAuth: form.workAuth.checked,
      workHistory: get("workHistory"),
      whyUs: get("whyUs"),
      rate: get("rate"),
      heardFrom: get("heardFrom")
    };

    /* Each row: is it missing, how to say so, and the element whose
       question gets marked. Kept in the order the form is read, so the
       first one marked is the first one a person comes to. */
    var byId = function (id) { return document.getElementById(id); };
    var checks = [
      [!p.firstName, "your first name", byId("firstName")],
      [!p.lastName, "your last name", byId("lastName")],
      [p.phone.replace(/\D/g, "").length < 10, "a complete phone number", byId("phone")],
      [p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email), "an email address we can read, or leave it empty", byId("email")],
      [!p.city, "the town you live in", byId("city")],
      [!p.roleFit, "whether two days a week works for you", byId("roleFit")],
      [!p.desiredHours, "how many hours you are looking for", byId("desiredHours")],
      [!p.positionInterest.length, "what kind of work you are interested in", byId("f-posn")],
      [p.availability.length !== 2, "exactly two days you prefer to work", byId("f-avail")],
      [!p.startDate, "when you could start", byId("startDate")],
      [!p.groundsSkills.length && !p.otherSkills, "what grounds work you have done", byId("f-grounds")],
      [!p.equipment.length && !p.otherEquipment, "what equipment you can run", byId("f-equip")],
      [!p.horseExperience, "how comfortable you are around horses", byId("horseExperience")],
      [!p.license, "the driver’s license box", form.license],
      [!p.transportation, "the box about getting to and from work", form.transportation],
      [!p.workAuth, "the box saying you can work in the US", form.workAuth],
      [!p.workHistory, "where you have worked", byId("workHistory")]
    ];

    var missing = [];
    var first = null;
    checks.forEach(function (c) {
      var holder = c[2].closest(".f, .check");
      if (!c[0]) { if (holder) holder.classList.remove("error"); return; }
      missing.push(c[1]);
      if (holder) {
        holder.classList.add("error");
        if (!first) first = holder;
      }
    });

    if (missing.length) {
      /* Name what is missing while that is still a short sentence. Past
         a few, a list only reads as a wall, and the red marks say it
         better. */
      say(missing.length <= 3
        ? "We still need " + missing.join(", ") + ". We marked " +
          (missing.length === 1 ? "it" : "them") + " in red above."
        : "There are " + missing.length + " questions we still need answered. We marked them in red above.");
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    var fileInput = document.getElementById("resume");
    var file = fileInput.files && fileInput.files[0];
    /* Photos get shrunk below, so only documents are turned away here. */
    if (file && !isImage(file) && file.size > MAX_FILE_BYTES) {
      fileInput.closest(".f").classList.add("error");
      say("That file is bigger than 3 MB. Try a smaller one, or skip it and we will ask later.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";

    function finish() {
      form.hidden = true;
      /* The invitation to apply has been taken up, so it goes too: the
         heading over the form, and the Apply bar on a phone. */
      Array.prototype.forEach.call(
        document.querySelectorAll("[data-apply-intro], #applybar"),
        function (el) { el.hidden = true; });
      done.hidden = false;
      done.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function retry(text) {
      btn.disabled = false;
      btn.textContent = "Send my application";
      say(text);
    }

    var tooBigToShrink = false;
    var prep = file
      ? prepareResume(file, MAX_FILE_BYTES).then(function (packed) {
          if (packed) p.resume = packed;
          else tooBigToShrink = true;
        })
      : Promise.resolve();

    prep
      .then(function () {
        if (tooBigToShrink) {
          var err = new Error("photo could not be shrunk");
          err.friendly = "We could not read that photo. Try saving it as a JPEG or a PDF, " +
                         "or skip it and we will ask later.";
          throw err;
        }
        return fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p)
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error("Server responded " + res.status);
        finish();
      })
      .catch(function (err) {
        if (err && err.friendly) { retry(err.friendly); return; }
        retry("That did not go through. Check your signal and try again, or call us at (325) 627-3726 and we will take it over the phone.");
      });
  });
})();
