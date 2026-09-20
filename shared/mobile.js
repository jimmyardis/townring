/* ============================================================
   TownRing — shared mobile behaviour
   ------------------------------------------------------------
   Companion to shared/mobile.css. Two jobs, both phone-only:

     1. Move the legend, year slider and voice button into one
        .tr-dock flex column so they stack instead of overlapping.
     2. Put the control buttons behind a ☰ toggle.

   Everything is reversible: cross back over the breakpoint and
   the nodes return to their original parents, so rotating a
   phone or resizing a desktop window never strands the UI.

   Moving a node keeps its listeners and its id, so city map.js /
   voice.js keep working untouched.
   ============================================================ */

(function () {
  'use strict';

  var MOBILE = '(max-width: 640px)';
  var mq = window.matchMedia(MOBILE);

  // Dock members, in the order they should stack. Charleston uses
  // .year-slider-wrap where the others use .time-slider.
  var DOCK_SELECTORS = [
    '#legend, .legend',
    '.time-slider, .year-slider-wrap',
    '.voice-cluster',
  ];

  var dock = null;
  var toggle = null;
  var homes = [];   // { node, parent, next } so we can put things back

  function firstMatch(selector) {
    return document.querySelector(selector);
  }

  function buildDock() {
    if (dock) return;

    dock = document.createElement('div');
    dock.className = 'tr-dock';

    DOCK_SELECTORS.forEach(function (sel) {
      var node = firstMatch(sel);
      if (!node) return;
      homes.push({ node: node, parent: node.parentNode, next: node.nextSibling });
      dock.appendChild(node);
    });

    document.body.appendChild(dock);
  }

  function teardownDock() {
    if (!dock) return;
    // Restore in reverse so each insertBefore reference is still valid
    homes.slice().reverse().forEach(function (h) {
      if (h.next && h.next.parentNode === h.parent) {
        h.parent.insertBefore(h.node, h.next);
      } else {
        h.parent.appendChild(h.node);
      }
    });
    homes = [];
    if (dock.parentNode) dock.parentNode.removeChild(dock);
    dock = null;
  }

  // Charleston keeps its layer picker in a free-floating .metric-selector
  // panel instead of inside .controls. Fold it in so every city puts the
  // layer picker behind the same ☰.
  function adoptStrayMetricSelector(controls) {
    var stray = document.querySelector('.metric-selector');
    if (!stray || controls.contains(stray)) return;
    homes.push({ node: stray, parent: stray.parentNode, next: stray.nextSibling });
    controls.insertBefore(stray, controls.firstChild);
  }

  function buildToggle() {
    var controls = document.querySelector('.controls');
    if (!controls || toggle) return;

    adoptStrayMetricSelector(controls);

    toggle = document.createElement('button');
    toggle.className = 'tr-controls-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Map layers and controls');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = '☰';

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = controls.classList.toggle('tr-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? '✕' : '☰';
    });

    // Tapping the map dismisses the panel; taps inside it do not.
    document.addEventListener('click', function (e) {
      if (!controls.classList.contains('tr-open')) return;
      if (controls.contains(e.target) || e.target === toggle) return;
      controls.classList.remove('tr-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = '☰';
    });

    // Picking a layer is a complete action — close so the map is visible.
    var selector = controls.querySelector('select');
    if (selector) {
      selector.addEventListener('change', function () {
        controls.classList.remove('tr-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '☰';
      });
    }

    document.body.appendChild(toggle);
  }

  function teardownToggle() {
    var controls = document.querySelector('.controls');
    if (controls) controls.classList.remove('tr-open');
    if (toggle && toggle.parentNode) toggle.parentNode.removeChild(toggle);
    toggle = null;
  }

  // The legend is the one dock member that can get tall, so let it fold.
  function wireLegendCollapse() {
    var legend = document.querySelector('#legend, .legend');
    if (!legend || legend.dataset.trCollapseWired) return;
    var title = legend.querySelector('.legend-title');
    if (!title) return;

    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.addEventListener('click', function () {
      legend.classList.toggle('tr-collapsed');
    });
    title.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        legend.classList.toggle('tr-collapsed');
      }
    });
    legend.dataset.trCollapseWired = '1';
  }

  function apply() {
    if (mq.matches) {
      buildDock();
      buildToggle();
      wireLegendCollapse();
    } else {
      teardownDock();
      teardownToggle();
    }
  }

  function start() {
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);   // Safari < 14
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
