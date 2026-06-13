/** Shared Runway interactions + flagship (Direction B) */
(function () {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Page load orchestration */
  requestAnimationFrame(() => {
    document.querySelectorAll('.load-seq').forEach((el) => el.classList.add('is-loaded'));
    document.body.classList.add('is-ready');
  });

  /* Scroll progress */
  const progressBar = document.querySelector('.scroll-progress');
  if (progressBar) {
    window.addEventListener(
      'scroll',
      () => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        progressBar.style.width = h > 0 ? `${(window.scrollY / h) * 100}%` : '0%';
      },
      { passive: true }
    );
  }

  /* Header on scroll */
  const header = document.querySelector('.site-header--flagship');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* Scroll reveals */
  const revealEls = document.querySelectorAll('.reveal, .pipeline-lane');
  if (revealEls.length) {
    if (prefersReduced) {
      revealEls.forEach((el) => el.classList.add('is-visible'));
    } else {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      );
      revealEls.forEach((el) => revealObserver.observe(el));
    }
  }

  /* Stat counters */
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = parseInt(el.dataset.count, 10);
    if (Number.isNaN(target)) return;
    const suffix = el.dataset.suffix || '';
    const run = () => {
      if (prefersReduced) {
        el.textContent = target + suffix;
        return;
      }
      const start = performance.now();
      const dur = 1200;
      const step = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          run();
          obs.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    obs.observe(el);
  });

  /* Takeoff scene — scroll-driven taxi → takeoff → fly, resets at top */
  const takeoffZone = document.getElementById('takeoff-zone');
  const takeoffScene = document.getElementById('takeoff-scene');
  const planeWrap = document.getElementById('takeoff-plane-wrap');
  const hudPhase = document.getElementById('takeoff-phase');
  const hudStep = document.getElementById('takeoff-step');
  const storyTrack = document.querySelector('.scroll-story__track');
  let clearanceLaunched = false;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getNarrativeProgress() {
    if (!storyTrack) return 0;
    const rect = storyTrack.getBoundingClientRect();
    const trackH = storyTrack.offsetHeight - window.innerHeight;
    if (trackH <= 0) return 0;
    const scrolled = Math.min(Math.max(-rect.top, 0), trackH);
    return scrolled / trackH;
  }

  /** Scroll progress through takeoff zone: 0 at top, 1 when zone fully scrolled */
  function getTakeoffScrollProgress() {
    if (!takeoffZone) return 0;
    const rect = takeoffZone.getBoundingClientRect();
    const nav = 64;
    const scrollable = Math.max(takeoffZone.offsetHeight - (window.innerHeight - nav), 1);
    const passed = Math.min(Math.max(nav - rect.top, 0), scrollable);
    return passed / scrollable;
  }

  function setPlaneTransform(xVw, yVh, rot, scale, opacity) {
    const xPx = (xVw / 100) * window.innerWidth;
    const yPx = (yVh / 100) * window.innerHeight;
    planeWrap.style.transform = `translate3d(${xPx}px, ${-yPx}px, 0) rotate(${-rot}deg) scale(${scale})`;
    planeWrap.style.opacity = String(opacity);
  }

  function applyTakeoffFromProgress(progress) {
    if (!takeoffScene || !planeWrap || clearanceLaunched) return;

    const inZone = takeoffZone && takeoffZone.getBoundingClientRect().bottom > 80;

    if (!inZone && progress > 0.95) {
      takeoffScene.classList.add('is-faded');
      takeoffScene.classList.remove('is-visible', 'is-airborne');
      planeWrap.classList.add('is-hidden');
      takeoffZone.classList.add('is-past-takeoff');
      return;
    }

    takeoffZone.classList.remove('is-past-takeoff');
    takeoffScene.classList.remove('is-faded');
    takeoffScene.classList.add('is-visible');
    planeWrap.classList.remove('is-hidden');
    takeoffScene.classList.remove('is-rolling', 'is-cleared', 'is-airborne');

    let phase = 'Clearance · Standby';
    let stepNum = 1;
    let xVw = 8;
    let yVh = 0;
    let rot = 0;
    let scale = 1;
    let planeOpacity = 0.95;
    let hudOpacity = 0.75;

    if (progress < 0.08) {
      phase = 'Clearance · Standby';
      stepNum = 1;
      xVw = lerp(6, 10, progress / 0.08);
    } else if (progress < 0.32) {
      phase = 'Taxi';
      stepNum = 2;
      const t = (progress - 0.08) / 0.24;
      xVw = lerp(10, 42, t);
      takeoffScene.classList.add('is-rolling');
    } else if (progress < 0.48) {
      phase = 'Rotation';
      stepNum = 3;
      const t = (progress - 0.32) / 0.16;
      xVw = lerp(42, 50, t);
      rot = lerp(0, 22, t);
      takeoffScene.classList.add('is-rolling', 'is-cleared');
    } else if (progress < 0.68) {
      phase = 'Climb';
      stepNum = 4;
      const t = (progress - 0.48) / 0.2;
      xVw = lerp(50, 68, t);
      yVh = lerp(0, 28, t);
      rot = lerp(22, 28, t);
      scale = lerp(1, 0.78, t);
      planeOpacity = lerp(0.95, 0.65, t);
      hudOpacity = lerp(0.75, 0.35, t);
      takeoffScene.classList.add('is-cleared', 'is-airborne');
    } else {
      phase = 'Cruise';
      stepNum = 5;
      const t = (progress - 0.68) / 0.32;
      xVw = lerp(68, 88, t);
      yVh = lerp(28, 65, t);
      rot = lerp(28, 12, t);
      scale = lerp(0.78, 0.5, t);
      planeOpacity = lerp(0.65, 0.5, t);
      hudOpacity = lerp(0.35, 0, t);
      takeoffScene.classList.add('is-cleared', 'is-airborne');
    }

    setPlaneTransform(xVw, yVh, rot, scale, planeOpacity);
    if (hudPhase) {
      hudPhase.textContent = phase;
      if (hudPhase.parentElement) hudPhase.parentElement.style.opacity = String(hudOpacity);
    }
    if (hudStep) hudStep.textContent = `Step ${stepNum} of 5`;
  }

  function bindTakeoffScroll(handler) {
    let ticking = false;
    const tick = () => {
      handler();
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(tick);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    handler();
  }

  /* Scroll narrative + synced takeoff */
  if (storyTrack) {
    const stages = document.querySelectorAll('.story-node');
    const dots = document.querySelectorAll('.scroll-story__dot');
    const copyTitle = document.getElementById('story-title');
    const copyDesc = document.getElementById('story-desc');
    const copyLabel = document.getElementById('story-label');
    const storyStep = document.getElementById('story-step');
    const storyPhaseHud = document.getElementById('story-phase-hud');
    const storyHint = document.getElementById('story-hint');
    const storyData = [
      { label: 'Step 01 · Pre-flight', title: 'Voice locked in.', desc: 'One 5–10 minute sample. Brand voice, tone, and posting destinations configured once.', phase: 'Pre-flight', step: 1 },
      { label: 'Step 02 · Taxi', title: 'Topics roll to script.', desc: 'Research-backed drafts in your voice — review or auto-approve. No blank page.', phase: 'Taxi', step: 2 },
      { label: 'Step 03 · Rotation', title: 'Clone. Render. Lift off.', desc: 'ElevenLabs voice, Creatomate video, branded templates — zero editing sessions.', phase: 'Rotation', step: 3 },
      { label: 'Step 04 · Climb', title: 'Every channel. On schedule.', desc: 'LinkedIn, IG, TikTok, Shorts — cross-posted weekly without you touching a tool.', phase: 'Climb', step: 4 },
      { label: 'Step 05 · Cruise', title: 'Dashboard online.', desc: 'Track your manifest, taxi tracks, and upcoming departures from one portal.', phase: 'Cruise', step: 5 },
    ];

    const setStage = (i) => {
      stages.forEach((s, idx) => s.classList.toggle('is-active', idx === i));
      dots.forEach((d, idx) => d.classList.toggle('is-active', idx === i));
      const data = storyData[i];
      if (copyTitle) copyTitle.textContent = data.title;
      if (copyDesc) copyDesc.textContent = data.desc;
      if (copyLabel) copyLabel.textContent = data.label;
      if (storyStep) storyStep.textContent = data.step;
      if (storyPhaseHud) storyPhaseHud.textContent = data.phase;
    };

    if (prefersReduced) setStage(0);
    bindTakeoffScroll(() => {
      const storyProgress = getNarrativeProgress();
      const takeoffProgress = getTakeoffScrollProgress();
      if (!prefersReduced) {
        const idx = Math.min(storyData.length - 1, Math.floor(storyProgress * storyData.length));
        setStage(idx);
        if (storyHint && storyProgress > 0.08) storyHint.classList.add('is-hidden');
      }
      applyTakeoffFromProgress(takeoffProgress);
    });
  } else if (takeoffZone) {
    bindTakeoffScroll(() => applyTakeoffFromProgress(getTakeoffScrollProgress()));
  }

  /* Interactive deck tabs */
  const deckTabs = document.querySelectorAll('.deck-tab');
  if (deckTabs.length) {
    deckTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const id = tab.dataset.panel;
        deckTabs.forEach((t) => t.classList.toggle('is-active', t === tab));
        document.querySelectorAll('.deck-panel').forEach((p) => {
          p.classList.toggle('is-active', p.id === id);
        });
        document.querySelectorAll('.deck-preview__nav-item').forEach((n, i) => {
          n.classList.toggle('is-active', i === ['panel-overview', 'panel-pipeline', 'panel-publish', 'panel-queue'].indexOf(id));
        });
      });
    });
  }

  /* Pipeline flow animation */
  const flowNodes = document.querySelectorAll('.flow-node');
  const flowConnectors = document.querySelectorAll('.flow-connector');
  if (flowNodes.length && !document.querySelector('.scroll-story')) {
    let idx = 0;
    const tick = () => {
      flowNodes.forEach((n, i) => {
        n.classList.toggle('is-active', i === idx);
        n.classList.toggle('is-done', i < idx);
      });
      flowConnectors.forEach((c, i) => c.classList.toggle('is-done', i < idx));
      idx = (idx + 1) % flowNodes.length;
    };
    tick();
    if (!prefersReduced) setInterval(tick, 2200);
  }

  /* Request clearance CTA → lights → taxi → pricing */
  function runClearance(btn) {
    if (clearanceLaunched) return;
    clearanceLaunched = true;
    document.querySelectorAll('.btn--clearance').forEach((b) => b.classList.add('is-requesting'));

    if (takeoffScene) {
      takeoffScene.classList.add('is-visible', 'is-cleared', 'is-rolling');
    }

    if (planeWrap) {
      planeWrap.classList.remove('is-click-launch', 'is-hidden');
      setPlaneTransform(10, 0, 0, 1, 0.95);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          planeWrap.classList.add('is-click-launch');
          setPlaneTransform(88, 58, 16, 0.48, 0.55);
        });
      });
    }

    if (hudPhase) hudPhase.textContent = 'Clearance granted';
    if (hudStep) hudStep.textContent = 'Redirecting to pricing…';

    const dest = btn.dataset.clearanceHref || '/runway-pricing.html';
    window.setTimeout(() => {
      window.location.assign(dest);
    }, 2200);
  }

  document.querySelectorAll('.btn--clearance').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runClearance(btn);
    });
  });

  /* Magnetic primary CTAs (skip clearance buttons during launch) */
  document.querySelectorAll('.btn--magnetic').forEach((magnetic) => {
    if (prefersReduced) return;
    magnetic.addEventListener('mousemove', (e) => {
      if (magnetic.classList.contains('is-requesting')) return;
      const r = magnetic.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.15;
      const y = (e.clientY - r.top - r.height / 2) * 0.15;
      magnetic.style.transform = `translate(${x}px, ${y}px)`;
    });
    magnetic.addEventListener('mouseleave', () => {
      if (!magnetic.classList.contains('is-requesting')) magnetic.style.transform = '';
    });
  });

  /* Parallax */
  const parallaxEl = document.querySelector('[data-parallax]');
  if (parallaxEl && !prefersReduced) {
    window.addEventListener(
      'scroll',
      () => {
        parallaxEl.style.transform = `translateY(${window.scrollY * 0.04}px) rotate(-1deg)`;
      },
      { passive: true }
    );
  }

  /* Smooth scroll */
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    });
  });

  /* Login notices */
  const params = new URLSearchParams(location.search);
  const notice = document.getElementById('form-notice');
  if (notice) {
    if (params.get('error') === 'invalid') {
      notice.hidden = false;
      notice.className = 'form-notice form-notice--error';
      notice.textContent = 'That email or password did not match. Try again.';
    } else if (params.get('reset') === 'sent') {
      notice.hidden = false;
      notice.className = 'form-notice form-notice--success';
      notice.textContent = 'If that email is on file, a reset link is on the way.';
    }
  }
})();
