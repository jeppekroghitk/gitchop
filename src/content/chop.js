window.__gitchop = window.__gitchop || {};

(() => {
  const gc = window.__gitchop;

  const ANGLE = -9;
  const SWEEP = 240;
  const DARK_AT = 195;
  const DARK_IN = 120;
  const EASE_BLADE = 'cubic-bezier(0.28, 0.4, 0.2, 1)';
  const EASE_SOFT = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const EASE_BACK = 'cubic-bezier(0.5, 0, 0.2, 1)';
  const GLINT = 190;

  function div(className) {
    const node = document.createElement('div');
    node.className = className;
    return node;
  }

  /**
   * The blade and its bloom are boxes lying along the cut, so wiping them open from local right
   * to local left with a clip-path sweeps the cut across the viewport exactly once.
   */
  function geometry() {
    const radians = (ANGLE * Math.PI) / 180;
    return {
      length: (window.innerWidth / Math.cos(radians)) * 1.02,
      onCut: `translate(-50%, -50%) rotate(${ANGLE}deg)`,
      closed: 'inset(0 0 0 100%)',
      open: 'inset(0 0 0 0)',
    };
  }

  gc.createStage = function createStage({ reduced = false } = {}) {
    const geo = geometry();

    const host = document.createElement('gitchop-root');
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.zIndex = '2147483000';

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = gc.CSS;

    const scrim = div('gc-scrim');
    const bloom = div('gc-bloom');
    const cut = div('gc-cut');
    const glint = div('gc-glint');
    const menuLayer = div('gc-menu-layer');

    for (const line of [cut, bloom]) {
      line.style.width = `${geo.length}px`;
      line.style.transform = geo.onCut;
    }
    glint.style.width = `${GLINT}px`;
    cut.append(glint);

    // The blade sits above the dark but below the menu, so it never crosses the panel.
    shadow.append(style, scrim, bloom, cut, menuLayer);
    document.documentElement.append(host);

    const blockScroll = (event) => event.preventDefault();
    host.addEventListener('wheel', blockScroll, { passive: false });
    host.addEventListener('touchmove', blockScroll, { passive: false });

    /**
     * Keyboard events are composed, so they escape the shadow root and reach GitHub's own
     * hotkey handler on document — which sees the retargeted <gitchop-root> instead of our
     * input, decides nobody is typing, and fires s/e/t/y. Stopping them at the host on the
     * way out keeps the overlay's typing to itself. Bubble phase, so the panel's own
     * handlers inside the shadow tree still run first.
     */
    const keepKeys = (event) => event.stopPropagation();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      host.addEventListener(type, keepKeys);
    }

    let panelEl = null;
    const live = [];

    /** One-shot flourishes; nothing needs to unwind them on close. */
    function once(node, keyframes, options) {
      return node.animate(keyframes, { fill: 'both', ...options });
    }

    /** Tracked so close() can freeze the property wherever it got to and animate out from there. */
    function track(node, keyframes, options, props) {
      const animation = once(node, keyframes, options);
      live.push({ animation, node, props });
      return animation;
    }

    const stage = {
      host,
      shadow,
      menuLayer,

      /** The blade crosses the viewport once; the dark just fades in behind it. */
      chop() {
        const dark = track(
          scrim,
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: reduced ? 120 : DARK_IN, delay: reduced ? 0 : DARK_AT, easing: 'ease-out' },
          ['opacity'],
        );
        if (reduced) return dark.finished.catch(() => {});

        for (const line of [cut, bloom]) {
          once(line, [{ clipPath: geo.closed }, { clipPath: geo.open }], {
            duration: SWEEP,
            easing: EASE_BLADE,
          });
        }
        once(cut, [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], {
          duration: SWEEP + 200,
          easing: 'linear',
        });
        once(bloom, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.75, offset: 0.62 }, { opacity: 0 }], {
          duration: SWEEP + 230,
          easing: 'linear',
        });
        // Right to left: the glint's leading (left) edge tracks the clip boundary exactly.
        once(glint, [{ transform: `translateX(${geo.length}px)` }, { transform: 'translateX(0px)' }], {
          duration: SWEEP,
          easing: EASE_BLADE,
        });

        return dark.finished.catch(() => {});
      },

      revealPanel(panel) {
        panelEl = panel;
        return track(
          panel,
          [
            { opacity: 0, transform: 'translateY(8px) scale(0.99)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: reduced ? 120 : 200, easing: EASE_SOFT, delay: reduced ? 0 : DARK_AT + 45 },
          ['opacity', 'transform'],
        ).finished.catch(() => {});
      },

      /**
       * Reads every animated value, cancels, writes those values back inline, then animates
       * out from there. Reversing the open animations instead looked simpler but a finished
       * animation resolves `finished` immediately, so the overlay vanished within a frame.
       */
      async close() {
        const held = live.splice(0);
        const frozen = held.map(({ node, props }) => {
          const computed = getComputedStyle(node);
          return { node, values: props.map((prop) => [prop, computed.getPropertyValue(prop)]) };
        });
        for (const { animation } of held) animation.cancel();
        for (const { node, values } of frozen) {
          for (const [prop, value] of values) node.style.setProperty(prop, value);
        }

        const closing = [];
        const to = (node, keyframe, options) =>
          closing.push(node.animate([keyframe], { easing: EASE_BACK, fill: 'forwards', ...options }));

        if (panelEl) to(panelEl, { opacity: 0, transform: 'translateY(6px) scale(0.99)' }, { duration: 110 });
        to(scrim, { opacity: 0 }, { duration: reduced ? 100 : 170, delay: reduced ? 0 : 60 });

        await Promise.all(closing.map((animation) => animation.finished.catch(() => {})));
        stage.destroy();
      },

      destroy() {
        host.removeEventListener('wheel', blockScroll);
        host.removeEventListener('touchmove', blockScroll);
        for (const type of ['keydown', 'keypress', 'keyup']) {
          host.removeEventListener(type, keepKeys);
        }
        host.remove();
      },
    };

    return stage;
  };
})();
