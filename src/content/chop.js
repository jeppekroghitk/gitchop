window.__gitchop = window.__gitchop || {};

(() => {
  const gc = window.__gitchop;

  const ANGLE = -9;
  const SWEEP = 240;
  // The slice still plays out whole — the blade crosses in the clear — but everything after is
  // caused by the cut instead of merely following it: the dark spills out of the finished line
  // while its severed edges glow apart, and the menu rises into the opening. Nothing fades in
  // flat, and there is never a moment where the screen just waits.
  // Everything from the wound onward is measured from the impact, not from zero: the slice is
  // paced by the speed slider while the aftermath has its own, gentler pace (fx.afterPace).
  const WOUND = 320;
  const SCRIM_AT = WOUND * 0.75;
  const SCRIM_IN = 180;
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
   * to local left with a clip-path sweeps the cut across the viewport exactly once. The wound is
   * a square of 1.2 diagonals: its fully dark plateau (the 6%–94% gradient stops) then reaches
   * 0.528 diagonals out from the cut, past the farthest a corner can ever be (half a diagonal),
   * so the wound covers the whole screen at any angle and any aspect ratio — portrait included.
   */
  function geometry() {
    const radians = (ANGLE * Math.PI) / 180;
    return {
      length: (window.innerWidth / Math.cos(radians)) * 1.02,
      cover: Math.hypot(window.innerWidth, window.innerHeight) * 1.2,
      onCut: `translate(-50%, -50%) rotate(${ANGLE}deg)`,
      closed: 'inset(0 0 0 100%)',
      open: 'inset(0 0 0 0)',
    };
  }

  /**
   * Lightness slides from pure white toward the hue as tint rises, so tint 0 reproduces the
   * original rgba(255, 255, 255, …) values exactly; `drop` is how far each layer may fall.
   */
  function palette({ hue, tint }) {
    const tone = (drop, alpha) => `hsl(${hue} ${tint}% ${100 - (tint * drop) / 100}% / ${alpha})`;
    return {
      '--gc-blade-hi': tone(35, 0.92),
      '--gc-blade-lo': tone(35, 0.5),
      '--gc-blade-halo': tone(25, 0.55),
      '--gc-glint-hi': tone(18, 1),
      '--gc-glint-mid': tone(18, 0.55),
      '--gc-bloom-hi': tone(30, 0.26),
      '--gc-bloom-lo': tone(30, 0.1),
      '--gc-spark': tone(28, 1),
      '--gc-spark-halo': tone(28, 0.7),
      '--gc-flare': tone(15, 1),
    };
  }

  gc.createStage = function createStage({ reduced = false, effects } = {}) {
    const fx = gc.EFFECTS.resolve(effects);
    // Switched off in Settings: no blade, no wound — the scrim and menu simply appear.
    const instant = !fx.enabled;
    const quick = reduced || instant;
    // The slice multiplies by pace; everything after the impact multiplies by afterPace, which
    // trails the speed slider so the aftermath stays deliberate however fast the blade is.
    const { pace, afterPace } = fx;
    const geo = geometry();

    const host = document.createElement('gitchop-root');
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.zIndex = '2147483000';
    for (const [prop, value] of Object.entries(palette(fx))) {
      host.style.setProperty(prop, value);
    }
    host.style.setProperty('--gc-halo-size', `${fx.haloSize}px`);

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = gc.CSS;

    const scrim = div('gc-scrim');
    const wipe = div('gc-wipe');
    const edges = [div('gc-edge'), div('gc-edge')];
    const bloom = div('gc-bloom');
    const cut = div('gc-cut');
    const glint = div('gc-glint');
    const flare = div('gc-flare');
    const sparks = div('gc-sparks');
    const menuLayer = div('gc-menu-layer');

    for (const line of [cut, bloom, sparks, flare]) {
      line.style.width = `${geo.length}px`;
      line.style.transform = geo.onCut;
    }
    bloom.style.height = `${fx.bloomHeight}px`;
    flare.style.height = `${fx.flareHeight}px`;
    wipe.style.width = `${geo.cover}px`;
    wipe.style.height = `${geo.cover}px`;
    wipe.style.transform = `${geo.onCut} scaleY(0.004)`;
    for (const edge of edges) edge.style.width = `${geo.cover}px`;
    glint.style.width = `${GLINT}px`;
    cut.append(glint);

    // The wound and its edges sit under the blade; the flare hazes the line at impact; the sparks
    // ride above everything but the menu, so the embers keep glowing once the dark is in.
    shadow.append(style, scrim, wipe, ...edges, bloom, cut, flare, sparks, menuLayer);
    document.documentElement.append(host);

    /**
     * Wheel and touch scrolling must not reach the page behind the overlay — except inside a list
     * that has something to scroll, which scrolls itself; overscroll-behavior: contain on the lists
     * keeps one that has hit its edge from handing the rest of the gesture to the page. The listener
     * sits on the shadow root rather than the host: a closed shadow root retargets events for
     * listeners outside it, so from the host every wheel looks like it landed on the host itself.
     */
    const blockScroll = (event) => {
      const list = event.target?.closest?.('.gc-list');
      if (list && list.scrollHeight > list.clientHeight) return;
      event.preventDefault();
    };
    shadow.addEventListener('wheel', blockScroll, { passive: false });
    shadow.addEventListener('touchmove', blockScroll, { passive: false });

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

    /**
     * Tracked so close() can cancel it — pending or already playing — freeze the property
     * wherever it got to, and animate out from there.
     */
    function track(node, keyframes, options, props) {
      const animation = once(node, keyframes, options);
      live.push({ animation, node, props });
      return animation;
    }

    /**
     * The container lies along the cut like the bloom does, so a spark's coordinates are local to
     * the blade: x runs along it, y is perpendicular. Each spark ignites just as the glint passes
     * its position (never before) and is kicked backwards along the cut — the blade travels toward
     * local x = 0 — in a tight perpendicular band with a short life, so the trail hugs the slice
     * and dies out just behind the blade instead of littering the whole screen. Energy makes the
     * trail fiercer, not wider. No fill — the base style keeps a spark invisible until its own
     * animation starts.
     */
    function throwSparks(sweep) {
      const energy = fx.sparkEnergy;
      for (let i = 0; i < fx.sparkCount; i++) {
        const progress = Math.random();
        const spark = div('gc-spark');
        const size = (1.2 + Math.random() * 1.3) * energy;
        spark.style.width = `${Math.round(size * (3 + Math.random() * 4))}px`;
        spark.style.height = `${size.toFixed(1)}px`;
        spark.style.left = `${Math.round(geo.length * (1 - progress))}px`;
        sparks.append(spark);

        const along = (20 + Math.random() * 90) * energy * 0.6;
        const out = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 18) * (1 + (energy - 1) * 0.4);
        const fall = 8 + Math.random() * 22;
        const flight = spark.animate(
          [
            { transform: 'translate(0px, 0px)', opacity: 1 },
            { transform: `translate(${(along * 0.6).toFixed(1)}px, ${(out * 0.7).toFixed(1)}px)`, opacity: 0.9, offset: 0.55 },
            { transform: `translate(${along.toFixed(1)}px, ${(out + fall).toFixed(1)}px)`, opacity: 0 },
          ],
          {
            duration: (160 + Math.random() * 240) * (0.75 + 0.25 * energy) * afterPace,
            delay: sweep * progress * (1 + Math.random() * 0.08),
            easing: EASE_SOFT,
          },
        );
        flight.finished.then(() => spark.remove()).catch(() => {});
      }
    }

    const stage = {
      host,
      shadow,
      menuLayer,

      /**
       * The blade crosses once, then the cut splits into two glowing edges that sweep the dark
       * open behind them; the blurred scrim only fades in once the wound already covers the
       * screen, so the switch is invisible.
       */
      chop() {
        const dark = track(
          scrim,
          [{ opacity: 0 }, { opacity: 1 }],
          quick
            ? { duration: instant ? 90 : 120, easing: 'ease-out' }
            : { duration: SCRIM_IN * afterPace, delay: SWEEP * pace + SCRIM_AT * afterPace, easing: 'ease-out' },
          ['opacity'],
        );
        if (quick) return dark.finished.catch(() => {});

        const sweep = SWEEP * pace;
        for (const line of [cut, bloom]) {
          once(line, [{ clipPath: geo.closed }, { clipPath: geo.open }], {
            duration: sweep,
            easing: EASE_BLADE,
          });
        }
        // Right to left: the glint's leading (left) edge tracks the clip boundary exactly.
        once(glint, [{ transform: `translateX(${geo.length}px)` }, { transform: 'translateX(0px)' }], {
          duration: sweep,
          easing: EASE_BLADE,
        });
        // The line hands its light to the wound's edges: bright through the whole sweep, gone
        // shortly after they have carried it away. The rise and hold live on the slice's clock,
        // the dying tail on the aftermath's, so the offsets are computed rather than constant.
        const glow = (node, tail, dim) => {
          const duration = sweep + tail * afterPace;
          once(
            node,
            [
              { opacity: 0 },
              { opacity: 1, offset: (50 * pace) / duration },
              { opacity: dim, offset: sweep / duration },
              { opacity: 0 },
            ],
            { duration, easing: 'linear' },
          );
        };
        glow(cut, 180, 1);
        glow(bloom, 220, 0.8);

        // The wound: a dark sheet scales open from the cut while an edge line rides each side of
        // the widening gap — same delay, duration and easing, so they sit exactly on its boundary
        // — cooling as they travel. All of it is tracked, so an early close freezes the dark
        // where it is instead of letting a still-pending wound burst open over the closing screen.
        const wound = WOUND * afterPace;
        track(wipe, [{ opacity: 0 }, { opacity: 1 }], { duration: 40 * afterPace, delay: sweep }, ['opacity', 'transform']);
        track(
          wipe,
          [{ transform: `${geo.onCut} scaleY(0.004)` }, { transform: `${geo.onCut} scaleY(1)` }],
          { duration: wound, delay: sweep, easing: EASE_SOFT },
          ['opacity', 'transform'],
        );
        edges.forEach((edge, index) => {
          const reach = (index === 0 ? -1 : 1) * (geo.cover / 2);
          track(
            edge,
            [{ transform: `${geo.onCut} translateY(0px)` }, { transform: `${geo.onCut} translateY(${reach.toFixed(1)}px)` }],
            { duration: wound, delay: sweep, easing: EASE_SOFT },
            ['opacity', 'transform'],
          );
          track(
            edge,
            [{ opacity: 0 }, { opacity: 0.9, offset: 0.1 }, { opacity: 0 }],
            { duration: wound, delay: sweep, easing: 'linear' },
            ['opacity', 'transform'],
          );
        });

        if (fx.sparkCount > 0) throwSparks(sweep);
        if (fx.flarePeak > 0) {
          // The impact is light bursting from the cut itself, never a screen-wide flash: it pops
          // as the blade exits and dies while the dark is still spreading.
          track(
            flare,
            [{ opacity: 0 }, { opacity: 0.9 * fx.flarePeak ** 0.7, offset: 0.18 }, { opacity: 0 }],
            { duration: (240 + 140 * fx.flarePeak) * afterPace, delay: sweep, easing: 'ease-out' },
            ['opacity'],
          );
        }

        return dark.finished.catch(() => {});
      },

      /**
       * The beat between the blade leaving the screen and the menu rising is the one timing the
       * settings page owns outright (fx.panelAt) — the rest of the aftermath keeps its tuned
       * constants. Reduced motion and the off switch skip the wait entirely: there is no cut for
       * the menu to rise into.
       */
      revealPanel(panel) {
        panelEl = panel;
        return track(
          panel,
          [
            { opacity: 0, transform: 'translateY(10px) scale(0.985)' },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: instant ? 90 : reduced ? 120 : 240,
            easing: EASE_SOFT,
            delay: quick ? 0 : SWEEP * pace + fx.panelAt * afterPace,
          },
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
        for (const glow of [...edges, flare]) to(glow, { opacity: 0 }, { duration: 90 });
        for (const dark of [scrim, wipe]) to(dark, { opacity: 0 }, { duration: reduced ? 100 : 170, delay: reduced ? 0 : 60 });

        await Promise.all(closing.map((animation) => animation.finished.catch(() => {})));
        stage.destroy();
      },

      destroy() {
        shadow.removeEventListener('wheel', blockScroll);
        shadow.removeEventListener('touchmove', blockScroll);
        for (const type of ['keydown', 'keypress', 'keyup']) {
          host.removeEventListener(type, keepKeys);
        }
        host.remove();
      },
    };

    return stage;
  };
})();
