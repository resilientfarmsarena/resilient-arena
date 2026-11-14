/* Shows a small badge when the Coming Soon gate is unlocked in this
   browser (see middleware.js). The badge only reads a marker cookie; the
   real unlock cookie is HttpOnly and never visible to script. */
(function () {
  if (!/(?:^|;\s*)ra_preview_ui=1(?:;|$)/.test(document.cookie)) return;
  function show() {
    if (document.getElementById('ra-preview-badge')) return;
    var exit = new URL(location.href);
    exit.searchParams.set('preview', 'off');
    var box = document.createElement('div');
    box.id = 'ra-preview-badge';
    box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
      'background:#3A382E;color:#FDFAF5;font:500 12px/1.3 Jost,system-ui,sans-serif;' +
      'padding:8px 12px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.25);' +
      'display:flex;gap:10px;align-items:center;max-width:calc(100vw - 24px)';
    var label = document.createElement('span');
    label.textContent = 'Preview mode, visitors see Coming Soon';
    var link = document.createElement('a');
    link.href = exit.pathname + exit.search + exit.hash;
    link.textContent = 'Exit';
    link.style.cssText = 'color:#ADA578;text-decoration:underline;font-weight:500';
    box.appendChild(label);
    box.appendChild(link);
    document.body.appendChild(box);
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
