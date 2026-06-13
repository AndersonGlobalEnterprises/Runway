(() => {
  const STEPS = ['Queued', 'Research Complete', 'Script Ready', 'Audio Ready', 'Video Ready', 'Approved', 'Published'];
  const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'Facebook', 'X'];

  const state = {
    view: 'overview',
    flights: [],
    config: null,
    summary: null,
    contentTypes: [],
    online: true,
    selectedFlight: null,
    editState: null,
    drawerTab: 'script',
    platformSelection: [],
    me: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  async function api(path, opts = {}) {
    const res = await fetch(`/api/runway${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function toast(msg, type = '') {
    const el = $('#deck-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `deck-toast is-visible${type ? ` is-${type}` : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-visible'), 3500);
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function statusClass(status) {
    if (/script/i.test(status)) return 'status-pill--script';
    if (/audio/i.test(status)) return 'status-pill--audio';
    if (/video/i.test(status)) return 'status-pill--video';
    if (status === 'Approved') return 'status-pill--approved';
    if (status === 'Published') return 'status-pill--published';
    return 'status-pill--queued';
  }

  function stepIndex(status) {
    const i = STEPS.indexOf(status);
    return i >= 0 ? i : 0;
  }

  function pipeHtml(status) {
    const si = stepIndex(status);
    return STEPS.map((s, i) => {
      let cls = '';
      if (i < si) cls = 'is-done';
      else if (i === si) cls = 'is-active';
      return `<span class="${cls}" title="${esc(s)}"></span>`;
    }).join('');
  }

  function fillContentTypeSelects() {
    const opts = state.contentTypes
      .map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`)
      .join('');
    ['field-content-type', 'field-template', 'topic-content-type'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = opts;
    });
  }

  // ── /me — load user identity and apply context ────────────────────────────

  async function loadMe() {
    try {
      state.me = await api('/me');
      applyUserContext(state.me);
    } catch { /* non-fatal */ }
  }

  function applyUserContext(me) {
    if (!me) return;

    // Update company name
    const companyEl = document.getElementById('client-company');
    if (companyEl && me.company) companyEl.textContent = me.company;

    // Owner badge
    const ownerBadge = document.getElementById('owner-badge');
    const tierBadge = document.getElementById('client-tier-badge');
    const footer = document.getElementById('sidebar-footer');

    if (me.isOwner) {
      if (ownerBadge) ownerBadge.hidden = false;
      if (tierBadge) tierBadge.hidden = true;
      if (footer) footer.innerHTML = 'Owner access <strong class="instrument-label--amber">No billing</strong>';
    } else if (tierBadge && me.tier) {
      const label = me.tier.charAt(0).toUpperCase() + me.tier.slice(1);
      tierBadge.textContent = `${label} plan`;
    }

    // Role-based checklist: scale/platform/owner auto-collapse
    const scaleTiers = ['scale', 'platform', 'agency', 'owner'];
    if (scaleTiers.includes(me.tier || '') || me.isOwner) {
      document.getElementById('onboard-checklist')?.classList.add('onboard-checklist--collapsed');
    }

    // Owner-only elements
    if (me.isOwner) {
      $$('.owner-only').forEach(el => { el.hidden = false; });
      $$('.non-owner-only').forEach(el => { el.hidden = true; });
    }

    // Start guided tour on first login (one-time, keyed by email)
    const tourKey = `runway_tour_done_${me.email}`;
    if (!localStorage.getItem(tourKey)) {
      setTimeout(startTour, 800);
    }

    // Restore checklist state
    syncChecklistUI(me.email);
  }

  // ── Onboarding checklist ──────────────────────────────────────────────────

  function checksKey(email) {
    return `runway_checks_${email || 'guest'}`;
  }

  function getChecks(email) {
    try { return JSON.parse(localStorage.getItem(checksKey(email)) || '{}'); } catch { return {}; }
  }

  function markCheck(key) {
    const email = state.me?.email;
    const checks = getChecks(email);
    checks[key] = true;
    localStorage.setItem(checksKey(email), JSON.stringify(checks));
    syncChecklistUI(email);
  }

  function syncChecklistUI(email) {
    const checks = getChecks(email);
    const checklist = document.getElementById('onboard-checklist');
    if (!checklist) return;

    $$('li[data-check]', checklist).forEach((li) => {
      li.classList.toggle('is-done', !!checks[li.dataset.check]);
    });

    // Hide checklist when all 6 done
    const keys = ['brand', 'topics', 'script', 'video', 'publish', 'plan'];
    if (keys.every((k) => checks[k])) {
      checklist.classList.add('onboard-checklist--collapsed');
    }
  }

  // ── Guided tour ───────────────────────────────────────────────────────────

  const TOUR_STEPS = [
    {
      target: '.stat-grid',
      title: 'Welcome to your flight deck',
      body: 'These four numbers track posts and videos equally — what\'s on manifest, topics on hold, and live destinations.',
    },
    {
      target: '#btn-request-topics',
      title: 'Start here',
      body: 'Click "Request topics" to queue 3–5 topic ideas. One per line. The pipeline picks them up automatically.',
    },
    {
      target: '.dashboard-nav__item[data-view="taxi"]',
      title: 'Taxi tracks',
      body: 'Every flight in production lives here. Click any card to open the editor — script, post, video, and publish.',
    },
    {
      target: '.drawer-tabs',
      title: 'Four clearance gates',
      body: 'Script → Post → Video → Publish. Posts and video carry equal weight. Nothing advances until you clear each stage.',
    },
    {
      target: '.dashboard-nav__item[data-view="strategy"]',
      title: 'Weekly flight plan',
      body: 'AI-generated content strategy — when to post, what to post, why it works. Check it every Monday.',
    },
  ];

  let tourStep = -1;
  let tourBeaconEl = null;

  function startTour() {
    tourStep = 0;
    showTourStep(0);
    document.getElementById('tour-overlay').hidden = false;
  }

  function showTourStep(i) {
    const step = TOUR_STEPS[i];
    if (!step) { endTour(); return; }

    // Remove previous beacon
    if (tourBeaconEl) { tourBeaconEl.classList.remove('tour-beacon'); tourBeaconEl = null; }

    // Apply beacon to target
    const target = document.querySelector(step.target);
    if (target) { target.classList.add('tour-beacon'); tourBeaconEl = target; }

    document.getElementById('tour-step-label').textContent = `Step ${i + 1} of ${TOUR_STEPS.length}`;
    document.getElementById('tour-step-title').textContent = step.title;
    document.getElementById('tour-step-body').textContent = step.body;
    document.getElementById('tour-prev').style.display = i === 0 ? 'none' : '';
    document.getElementById('tour-next').textContent = i === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
  }

  function endTour() {
    document.getElementById('tour-overlay').hidden = true;
    if (tourBeaconEl) { tourBeaconEl.classList.remove('tour-beacon'); tourBeaconEl = null; }
    const email = state.me?.email;
    if (email) localStorage.setItem(`runway_tour_done_${email}`, '1');
    tourStep = -1;
  }

  // ── Help drawer ───────────────────────────────────────────────────────────

  function openHelpDrawer() {
    document.getElementById('help-drawer')?.classList.add('is-open');
  }
  function closeHelpDrawer() {
    document.getElementById('help-drawer')?.classList.remove('is-open');
  }

  // ── Data refresh ──────────────────────────────────────────────────────────

  async function refreshAll() {
    try {
      const [summary, flightsPayload, config, typesPayload] = await Promise.all([
        api('/client/summary'),
        api('/flights'),
        api('/config'),
        api('/content-types'),
      ]);
      state.summary = summary;
      state.flights = flightsPayload.flights || [];
      state.online = flightsPayload.online !== false;
      state.config = config;
      state.contentTypes = typesPayload.contentTypes || [];
      fillContentTypeSelects();
      render();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function renderHeader() {
    const s = state.summary;
    if (!s) return;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null) el.textContent = val;
    };
    set('stat-posts', s.posts);
    set('stat-videos', s.videos);
    set('stat-topics', s.topics);
    set('stat-platforms', s.platforms);
    set('client-name', s.client);
    set('deck-pipeline-tag', s.pipeline === 'online' ? 'Pipeline online' : 'Pipeline offline');
    if (s.client) {
      set('client-avatar', s.client.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase());
    }
    const bar = $('#cockpit-status-dynamic');
    if (bar) {
      bar.innerHTML = `
        <span>Clearance: <strong>Active</strong></span>
        <span>Squawk: <strong>${esc(s.squawk || 'RWY-0001')}</strong></span>
        <span>Taxi tracks: <strong>${(s.tracks || []).filter((t) => t.active).length} running</strong></span>
        <span>Next departure: <strong>${esc(s.nextDeparture || '—')}</strong></span>`;
    }
  }

  function renderOverview() {
    const departures = state.flights.filter((f) => !['Queued', 'Research Complete', 'Error'].includes(f.status)).slice(0, 6);
    const hold = state.flights.filter((f) => ['Queued', 'Research Complete'].includes(f.status)).slice(0, 6);

    const depEl = $('#departures-list');
    if (depEl) {
      depEl.innerHTML = departures.length
        ? departures.map(flightRow).join('')
        : '<p class="empty-copy">After you clear post or video, set a departure time on the Publish tab.</p>';
    }

    const holdEl = $('#hold-list');
    if (holdEl) {
      holdEl.innerHTML = hold.length
        ? hold.map((f) => `<div class="schedule-item" style="grid-template-columns:1fr auto;cursor:pointer" data-flight-id="${esc(f.id)}">
            <div><div class="schedule-item__title">${esc(f.topic || 'Untitled')}</div>
            <div class="schedule-item__meta">On hold · ${esc(f.product)}</div></div><span class="tag">Pending</span></div>`).join('')
        : '<div class="empty-state"><h4>Hold queue empty</h4><p>Paste 3–5 topics (one per line). Example: Roof myths, storm signs, insurance tips.</p></div>';
    }

    const tracksEl = $('#tracks-list');
    if (tracksEl && state.summary?.tracks) {
      const tracks = state.summary.tracks;
      tracksEl.innerHTML = tracks.length
        ? tracks.map((t) => `<div class="track-row"><span class="track-row__name">${esc(t.name)}</span><span class="track-row__status">${esc(t.status)}</span></div>`).join('')
        : '<div class="empty-state"><p>No flights yet. Queue a topic above to launch the pipeline.</p></div>';
    }
    renderWeekTimeline();
  }

  function renderWeekTimeline() {
    const el = $('#week-timeline-slots');
    if (!el) return;
    el.innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((_, i) => {
      const f = state.flights[i % Math.max(state.flights.length, 1)];
      if (f && f.status !== 'Queued') {
        return `<div class="week-timeline__slot has-post" title="${esc(f.topic)}" data-flight-id="${esc(f.id)}">Dep</div>`;
      }
      return '<div class="week-timeline__slot"></div>';
    }).join('');
  }

  function flightRow(f) {
    const time = f.scheduledAt
      ? new Date(f.scheduledAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      : f.createdAt ? new Date(f.createdAt).toLocaleDateString('en-US', { weekday: 'short' }) : 'Scheduled';
    return `<div class="schedule-item" data-flight-id="${esc(f.id)}" style="cursor:pointer">
      <span class="schedule-item__time">${esc(time)}</span>
      <div><div class="schedule-item__title">${esc(f.topic || 'Untitled')}</div>
      <div class="schedule-item__meta">${esc(f.platforms || '')} · ${esc(f.status)}</div></div>
      <span class="status-pill ${statusClass(f.status)}">${esc(f.status)}</span></div>`;
  }

  function renderTaxiTracks() {
    const root = $('#taxi-tracks-root');
    if (!root) return;
    let flights = [...state.flights];
    root.innerHTML = `
      ${!state.online ? '<div class="offline-banner">Pipeline offline — showing cached queue.</div>' : ''}
      <div class="deck-toolbar">
        <select class="deck-select" id="taxi-filter"><option value="">All taxi tracks</option><option>Inspect</option><option>Talksmith</option><option>Interview Prep</option></select>
        <button type="button" class="btn btn--secondary" id="btn-trigger-pipeline">Run publish pipeline</button>
      </div>
      <div id="flight-cards">${flights.map(flightCard).join('') || '<p class="empty-copy">No flights on taxi tracks. Queue a topic above to launch the pipeline.</p>'}</div>`;
    root.querySelector('#taxi-filter')?.addEventListener('change', (e) => {
      const v = e.target.value;
      $$('#flight-cards .flight-card').forEach((c) => { c.hidden = v && c.dataset.product !== v; });
    });
    root.querySelector('#btn-trigger-pipeline')?.addEventListener('click', async () => {
      try {
        await api('/pipeline/trigger', { method: 'POST', body: JSON.stringify({ product: state.config?.product }) });
        toast('Publish pipeline triggered', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function flightCard(f) {
    return `<article class="flight-card" data-flight-id="${esc(f.id)}" data-product="${esc(f.product)}" data-status="${esc(f.status)}">
      <div><div class="flight-card__title">${esc(f.topic || 'Untitled')}</div>
      <div class="flight-card__meta">${esc(f.product)} · ${esc(f.status)}</div>
      <div class="flight-card__pipe">${pipeHtml(f.status)}</div></div>
      <span class="status-pill ${statusClass(f.status)}">${esc(f.status)}</span></article>`;
  }

  function renderBrand() {
    const root = $('#brand-root');
    const b = state.config?.brand || {};
    const mem = state.config?.memory || {};
    if (!root) return;
    root.innerHTML = `
      <form id="brand-form" class="brand-grid">
        <div class="panel cockpit-bezel"><div class="panel__header"><span class="panel__title">Voice & brand brief</span></div>
          <div class="panel__body">
            <div class="form-field"><label>Audience</label><input name="audience" value="${esc(b.audience)}"></div>
            <div class="form-field"><label>Vertical</label><input name="vertical" value="${esc(b.vertical)}"></div>
            <div class="form-field"><label>Tone</label><textarea name="tone" rows="2">${esc(b.tone)}</textarea></div>
            <div class="form-field"><label>Default CTA</label><input name="cta" value="${esc(b.cta)}"></div>
            <div class="form-field"><label>Brand color</label><input name="primaryColor" type="color" value="${esc(b.primaryColor || '#1e40af')}"></div>
            <div class="form-field"><label>Logo URL</label><input name="logoUrl" value="${esc(b.logoUrl)}"></div>
            <div class="form-field"><label>Phrases to use</label><input name="phrasesUse" value="${esc((b.phrasesUse || []).join(', '))}"></div>
            <div class="form-field"><label>Phrases to avoid</label><input name="phrasesAvoid" value="${esc((b.phrasesAvoid || []).join(', '))}"></div>
          </div></div>
        <div class="panel cockpit-bezel"><div class="panel__header"><span class="panel__title">Integrations</span></div>
          <div class="panel__body">
            <div class="form-field"><label>Voice ID</label><input name="voiceId" value="${esc(state.config?.integrations?.voiceId)}"></div>
            <div class="form-field"><label>Sheet ID</label><input name="sheetId" value="${esc(state.config?.integrations?.sheetId)}"></div>
            <div class="form-field"><label>Default template ID</label><input name="creatomateTemplateId" value="${esc(state.config?.integrations?.creatomateTemplateId)}"></div>
          </div></div>
        <div class="panel cockpit-bezel"><div class="panel__header"><span class="panel__title">AI memory</span></div>
          <div class="panel__body memory-list">${(mem.editSignals || []).slice(0, 8).map((m) => `<div class="memory-item">${esc(m.summary)}</div>`).join('') || '<p class="empty-copy">Edits train your voice here.</p>'}</div></div>
        <button type="submit" class="btn btn--primary">Save brand</button>
      </form>`;
  }

  async function renderStrategy() {
    const root = $('#strategy-root');
    if (!root) return;
    root.innerHTML = '<p class="empty-copy">Loading flight plan…</p>';
    try {
      const plan = await api('/strategy/weekly');
      root.innerHTML = `
        <div class="panel cockpit-bezel strategy-plan">
          <div class="panel__header"><span class="panel__title">Weekly flight plan</span>
            <span class="tag">${plan.available ? 'Perplexity' : 'Built-in'}</span></div>
          <div class="panel__body">
            <p style="margin-bottom:16px;">${esc(plan.summary)}</p>
            ${(plan.posts || []).map((p) => `<div class="strategy-post"><strong>${esc(p.day)} ${esc(p.time)}</strong> · ${esc(p.platform)} · ${esc(p.format || 'post')} · ${esc(p.contentType)}<br>
              <span style="color:var(--text-muted)">${esc(p.topicIdea)}</span><br><em style="font-size:0.8125rem">${esc(p.rationale)}</em></div>`).join('')}
            ${(plan.warnings || []).length ? `<div class="strategy-hints" style="margin-top:16px"><strong>Warnings</strong><ul>${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
          </div></div>`;
    } catch (e) {
      root.innerHTML = `<p class="empty-copy">${esc(e.message)}</p>`;
    }
  }

  function renderManifest() {
    const root = $('#manifest-root');
    if (!root) return;
    const scheduled = state.flights.filter((f) => f.status !== 'Published');
    root.innerHTML = `<div class="panel cockpit-bezel"><div class="panel__header"><span class="panel__title">Weekly manifest</span></div>
      <div class="panel__body">${scheduled.map(flightRow).join('') || '<p class="empty-copy">Nothing on manifest yet. Queue topics to start.</p>'}</div></div>`;
  }

  function render() {
    renderHeader();
    $$('.deck-view').forEach((v) => { v.hidden = v.dataset.view !== state.view; });
    const titles = {
      overview: ['Overview', 'Taxi tracks, manifest, and weekly departures at a glance.'],
      taxi: ['Taxi tracks', 'Click any flight to edit script, post, video, and publish settings.'],
      brand: ['Voice & brand', 'Brand brief and AI memory.'],
      manifest: ['Manifest', 'Scheduled departures — click to edit.'],
      strategy: ['Flight plan', 'Weekly strategy — when, how, and what to post.'],
    };
    const [h, sub] = titles[state.view] || titles.overview;
    if ($('#deck-heading')) $('#deck-heading').textContent = h;
    if ($('#deck-subheading')) $('#deck-subheading').textContent = sub;
    if (state.view === 'overview') renderOverview();
    if (state.view === 'taxi') renderTaxiTracks();
    if (state.view === 'brand') renderBrand();
    if (state.view === 'manifest') renderManifest();
    if (state.view === 'strategy') renderStrategy();
    $$('.dashboard-nav__item[data-view]').forEach((a) => a.classList.toggle('is-active', a.dataset.view === state.view));
  }

  // ── Drawer ────────────────────────────────────────────────────────────────

  function updateDrawerDeliveryMode(mode) {
    const m = mode || $('#field-delivery')?.value || 'video';
    const showPost = m === 'post' || m === 'hybrid';
    const showVideo = m === 'video' || m === 'hybrid';

    $$('.drawer-tab[data-drawer-tab="post"]').forEach((el) => { el.hidden = !showPost; });
    $$('.drawer-tab[data-drawer-tab="video"]').forEach((el) => { el.hidden = !showVideo; });

    const btnPost = $('#btn-approve-post');
    const btnVideo = $('#btn-approve-video');
    if (btnPost) btnPost.hidden = !showPost;
    if (btnVideo) btnVideo.hidden = !showVideo;

    const formatWrap = $('#field-format-wrap');
    if (formatWrap) formatWrap.hidden = !showVideo;

    const scriptField = $('#field-script')?.closest('.script-field');
    const lengthField = $('#field-length')?.closest('.script-field');
    if (scriptField) scriptField.hidden = m === 'post';
    if (lengthField) lengthField.hidden = m === 'post';

    if (!showPost && state.drawerTab === 'post') setDrawerTab('script');
    if (!showVideo && state.drawerTab === 'video') setDrawerTab(showPost ? 'post' : 'script');
  }

  function applyScriptToForm(script) {
    $('#field-hook').value = script.hook || '';
    $('#field-script').value = script.full_script || script.fullScript || '';
    $('#field-caption').value = script.caption || '';
    if (script.linkedInPost != null) $('#field-linkedin').value = script.linkedInPost || '';
    if (script.facebookPost != null) $('#field-facebook').value = script.facebookPost || '';
    if (script.xPost != null) $('#field-x').value = script.xPost || '';
  }

  function setDrawerTab(tab) {
    state.drawerTab = tab;
    $$('.drawer-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.drawerTab === tab));
    $$('.drawer-panel').forEach((p) => { p.hidden = p.dataset.drawerPanel !== tab; });
    if (tab === 'publish' && state.selectedFlight) loadPublishHints();
  }

  function toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocal(val) {
    if (!val) return '';
    return new Date(val).toISOString();
  }

  function populateDrawerFromEdit(data) {
    const e = data.edit;
    state.editState = data;
    state.platformSelection = Array.isArray(e.platforms) ? [...e.platforms] : PLATFORMS.slice(0, 3);
    $('#field-content-type').value = e.contentType || 'myth-bust';
    $('#field-template').value = e.contentType || 'myth-bust';
    $('#field-hook').value = e.hook || '';
    $('#field-script').value = e.fullScript || '';
    $('#field-caption').value = e.caption || '';
    $('#field-hashtags').value = e.hashtags || '';
    $('#field-cta').value = e.ctaLine || '';
    $('#field-tone').value = e.tone || 'direct';
    $('#field-length').value = e.length || '30s';
    $('#field-on-hook').value = e.onScreenHook || '';
    $('#field-on-cta').value = e.onScreenCta || '';
    $('#field-color').value = e.primaryColor || '#1e40af';
    $('#field-logo').value = e.logoUrl || '';
    $('#field-scheduled').value = toDatetimeLocal(e.scheduledAt);
    $('#field-delivery').value = e.deliveryMode || 'video';
    $('#field-format').value = e.postFormat || 'reel';
    $('#field-linkedin').value = e.linkedInPost || '';
    $('#field-facebook').value = e.facebookPost || '';
    $('#field-x').value = e.xPost || '';
    renderPlatformChips();
    updateDrawerDeliveryMode(e.deliveryMode);
    const videoUrl = e.videoUrl || e.previewVideoUrl;
    const wrap = $('#video-preview-wrap');
    const vid = $('#drawer-video');
    if (videoUrl && vid && wrap) {
      vid.src = videoUrl;
      wrap.hidden = false;
    } else if (wrap) wrap.hidden = true;
    const previews = $('#drawer-previews');
    if (previews) {
      previews.innerHTML = [
        e.audioUrl ? `<a href="${esc(e.audioUrl)}" target="_blank">Listen to voice</a>` : '',
        videoUrl ? `<a href="${esc(videoUrl)}" target="_blank">Open video</a>` : '',
      ].filter(Boolean).join('') || '<span class="empty-copy">Previews appear after voice and video stages (post-only flights skip this).</span>';
    }
  }

  function renderPlatformChips() {
    const root = $('#field-platforms');
    if (!root) return;
    root.innerHTML = PLATFORMS.map((p) => {
      const on = state.platformSelection.includes(p) ? ' is-on' : '';
      return `<span class="platform-chip${on}" data-platform="${esc(p)}">${esc(p)}</span>`;
    }).join('');
  }

  function collectEditPayload() {
    return {
      hook: $('#field-hook').value.trim(),
      fullScript: $('#field-script').value.trim(),
      caption: $('#field-caption').value.trim(),
      hashtags: $('#field-hashtags').value.trim(),
      ctaLine: $('#field-cta').value.trim(),
      tone: $('#field-tone').value,
      length: $('#field-length').value,
      contentType: $('#field-content-type').value,
      onScreenHook: $('#field-on-hook').value.trim(),
      onScreenCta: $('#field-on-cta').value.trim(),
      primaryColor: $('#field-color').value,
      logoUrl: $('#field-logo').value.trim(),
      templateVariant: $('#field-template').value,
      platforms: state.platformSelection,
      scheduledAt: fromDatetimeLocal($('#field-scheduled').value),
      deliveryMode: $('#field-delivery').value,
      postFormat: $('#field-format').value,
      linkedInPost: $('#field-linkedin').value.trim(),
      facebookPost: $('#field-facebook').value.trim(),
      xPost: $('#field-x').value.trim(),
    };
  }

  async function openDrawer(flight) {
    state.selectedFlight = flight;
    const drawer = $('#flight-drawer');
    if (!drawer) return;
    drawer.classList.add('is-open');
    drawer.querySelector('#drawer-title').textContent = flight.topic || 'Untitled';
    drawer.querySelector('#drawer-meta').textContent = `${flight.product} · ${flight.status} · row ${flight.rowId}`;
    drawer.querySelector('#drawer-pipe').innerHTML = pipeHtml(flight.status);
    setDrawerTab('script');
    try {
      const data = await api(`/flights/${encodeURIComponent(flight.id)}/edit`);
      populateDrawerFromEdit(data);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function closeDrawer() {
    $('#flight-drawer')?.classList.remove('is-open');
    state.selectedFlight = null;
    state.editState = null;
  }

  async function saveEdit(tab) {
    const f = state.selectedFlight;
    if (!f) return;
    try {
      const data = await api(`/flights/${encodeURIComponent(f.id)}/edit`, {
        method: 'PATCH',
        body: JSON.stringify({ tab: tab || state.drawerTab, edit: collectEditPayload() }),
      });
      populateDrawerFromEdit(data);
      toast('Changes saved', 'ok');
      await refreshAll();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function loadPublishHints() {
    const f = state.selectedFlight;
    const el = $('#publish-hints');
    if (!f || !el) return;
    try {
      const { hints } = await api(`/flights/${encodeURIComponent(f.id)}/publish-hints`);
      el.innerHTML = `<strong>Publish intelligence</strong><br>
        Best times: ${esc((hints.bestTimes || []).join(' · '))}<br>
        Format: ${esc(hints.format || 'reel')} · ${esc(hints.spacing || '')}<br>
        Tags: ${esc((hints.hashtags || []).join(' '))}`;
    } catch {
      el.innerHTML = '';
    }
  }

  async function rewrite(action) {
    const f = state.selectedFlight;
    if (!f) return;
    try {
      toast('Rewriting…');
      const { script } = await api(`/flights/${encodeURIComponent(f.id)}/rewrite`, {
        method: 'POST',
        body: JSON.stringify({ action, ...collectEditPayload() }),
      });
      $('#field-hook').value = script.hook || '';
      $('#field-script').value = script.full_script || script.fullScript || '';
      $('#field-caption').value = script.caption || '';
      if (script.linkedInPost != null) $('#field-linkedin').value = script.linkedInPost || '';
      if (script.facebookPost != null) $('#field-facebook').value = script.facebookPost || '';
      if (script.xPost != null) $('#field-x').value = script.xPost || '';
      toast('Rewrite ready — save when happy', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function renderVideo(preview) {
    const f = state.selectedFlight;
    if (!f) return;
    try {
      toast(preview ? 'Rendering preview…' : 'Rendering final…');
      const path = preview ? 'render-preview' : 'render-final';
      const res = await api(`/flights/${encodeURIComponent(f.id)}/${path}`, {
        method: 'POST',
        body: JSON.stringify({ edit: collectEditPayload() }),
      });
      if (res.mock) toast(res.message || 'Modifications saved — add CREATOMATE_API_KEY for renders', 'ok');
      else toast(preview ? 'Preview ready' : 'Final render ready', 'ok');
      if (res.previewUrl || res.videoUrl) {
        const url = res.previewUrl || res.videoUrl;
        $('#drawer-video').src = url;
        $('#video-preview-wrap').hidden = false;
      }
      await refreshAll();
      if (f) {
        const updated = state.flights.find((x) => x.id === f.id);
        if (updated) state.selectedFlight = updated;
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  function switchView(v) {
    state.view = v;
    if (v === 'brand')    markCheck('brand');
    if (v === 'strategy') markCheck('plan');
    if (v === 'clients')  renderClientsView();
    render();
    // Sync active state on both nav bars
    $$('.dashboard-nav__item[data-view], .mob-nav__item[data-view]').forEach(el => {
      el.classList.toggle('is-active', el.dataset.view === v);
    });
  }

  // ── Clients view (owner only) ─────────────────────────────────────────────

  async function renderClientsView() {
    const root = $('#clients-root');
    if (!root) return;
    root.innerHTML = '<p class="instrument-label" style="color:var(--amber)">Loading clients…</p>';
    try {
      const { clients } = await fetch('/api/runway/admin/clients', { credentials: 'include' }).then(r => r.json());
      if (!clients?.length) {
        root.innerHTML = `
          <div class="clients-empty">
            <p>No client services deployed yet.</p>
            <a href="/runway-intake.html" class="btn btn--primary" style="margin-top:16px;display:inline-block;">Onboard first client</a>
          </div>`;
        return;
      }
      root.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);">
          <h2 style="margin:0;">My Clients <span style="font-size:.9rem;color:var(--text-2);font-weight:400;">(${clients.length})</span></h2>
          <a href="/runway-intake.html" class="btn btn--primary btn--sm">+ New client</a>
        </div>
        <div class="clients-grid">
          ${clients.map(c => `
            <div class="client-card cockpit-bezel">
              <div class="client-card__name">${esc(c.company)}</div>
              <div class="client-card__url">${esc(c.url)}</div>
              <div class="client-card__meta">
                <span class="client-card__status client-card__status--${c.status}">${c.status}</span>
                <span class="instrument-label">${new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              <div class="client-card__actions">
                <a href="${esc(c.url)}" target="_blank" rel="noopener" class="btn btn--ghost btn--sm">Open dashboard</a>
                <a href="${esc(c.dashboardUrl)}" target="_blank" rel="noopener" class="btn btn--ghost btn--sm">Render</a>
              </div>
            </div>`).join('')}
        </div>`;
    } catch (e) {
      root.innerHTML = `<p style="color:#f87171">Error loading clients: ${esc(e.message)}</p>`;
    }
  }

  // ── Event bindings ────────────────────────────────────────────────────────

  function bindEvents() {
    // Sidebar nav + mobile bottom nav
    $$('.dashboard-nav__item[data-view], .mob-nav__item[data-view]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(el.dataset.view);
      });
    });

    document.body.addEventListener('click', (e) => {
      const card = e.target.closest('[data-flight-id]');
      if (card && !e.target.closest('.deck-drawer')) {
        const flight = state.flights.find((f) => f.id === card.dataset.flightId);
        if (flight) openDrawer(flight);
      }
      const chip = e.target.closest('.platform-chip');
      if (chip) {
        const p = chip.dataset.platform;
        if (state.platformSelection.includes(p)) state.platformSelection = state.platformSelection.filter((x) => x !== p);
        else state.platformSelection.push(p);
        renderPlatformChips();
      }
    });

    $$('.drawer-tab').forEach((tab) => {
      tab.addEventListener('click', () => setDrawerTab(tab.dataset.drawerTab));
    });

    ['field-on-hook', 'field-on-cta'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        const note = $('#video-sync-note');
        if (note) note.textContent = 'Video fields customized — no longer auto-syncing from Script.';
      });
    });

    $('#btn-request-topics')?.addEventListener('click', () => $('#topic-modal')?.classList.add('is-open'));
    $('#topic-modal-close')?.addEventListener('click', () => $('#topic-modal')?.classList.remove('is-open'));
    $('#topic-modal-backdrop')?.addEventListener('click', () => $('#topic-modal')?.classList.remove('is-open'));

    $('#topic-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('#topic-batch').value.trim();
      if (!text) return;
      try {
        const { results } = await api('/flights/queue', {
          method: 'POST',
          body: JSON.stringify({ text, contentType: $('#topic-content-type').value }),
        });
        toast(`${results.filter((r) => r.status === 'queued').length} topic(s) queued`, 'ok');
        $('#topic-modal').classList.remove('is-open');
        $('#topic-batch').value = '';
        markCheck('topics');
        await refreshAll();
      } catch (err) { toast(err.message, 'err'); }
    });

    $('#drawer-close')?.addEventListener('click', closeDrawer);
    $('#drawer-backdrop')?.addEventListener('click', closeDrawer);
    $('#btn-save-edit')?.addEventListener('click', () => saveEdit(state.drawerTab));
    $$('[data-rewrite]').forEach((btn) => btn.addEventListener('click', () => rewrite(btn.dataset.rewrite)));
    $('#btn-generate-script')?.addEventListener('click', async () => {
      const f = state.selectedFlight;
      if (!f) return;
      try {
        const { script } = await api(`/flights/${encodeURIComponent(f.id)}/generate`, {
          method: 'POST',
          body: JSON.stringify({
            topic: f.topic,
            contentType: $('#field-content-type').value,
            deliveryMode: $('#field-delivery').value,
          }),
        });
        applyScriptToForm(script);
        toast('Content generated', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#btn-render-preview')?.addEventListener('click', () => renderVideo(true));
    $('#btn-render-final')?.addEventListener('click', () => renderVideo(false));

    $('#btn-approve-script')?.addEventListener('click', async () => {
      const f = state.selectedFlight;
      if (!f) return;
      try {
        await saveEdit('script');
        await api(`/flights/${encodeURIComponent(f.id)}/approve`, { method: 'POST', body: JSON.stringify({ gate: 'script' }) });
        toast('Script cleared', 'ok');
        markCheck('script');
        closeDrawer();
        await refreshAll();
      } catch (e) { toast(e.message, 'err'); }
    });

    $('#field-content-type')?.addEventListener('change', () => {
      const ct = state.contentTypes.find((t) => t.id === $('#field-content-type').value);
      if (ct?.defaultDeliveryMode) {
        $('#field-delivery').value = ct.defaultDeliveryMode;
        updateDrawerDeliveryMode(ct.defaultDeliveryMode);
      }
    });

    $('#field-delivery')?.addEventListener('change', () => updateDrawerDeliveryMode($('#field-delivery').value));

    ['field-linkedin', 'field-facebook', 'field-x'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        const note = $('#post-sync-note');
        if (note) note.textContent = 'Post fields customized — no longer auto-syncing from Caption.';
      });
    });

    $('#btn-approve-post')?.addEventListener('click', async () => {
      const f = state.selectedFlight;
      if (!f) return;
      try {
        await saveEdit('post');
        await api(`/flights/${encodeURIComponent(f.id)}/approve`, { method: 'POST', body: JSON.stringify({ gate: 'post' }) });
        toast('Post cleared', 'ok');
        markCheck('publish');
        closeDrawer();
        await refreshAll();
      } catch (e) { toast(e.message, 'err'); }
    });

    $('#btn-approve-video')?.addEventListener('click', async () => {
      const f = state.selectedFlight;
      if (!f) return;
      try {
        await saveEdit('video');
        await api(`/flights/${encodeURIComponent(f.id)}/approve`, { method: 'POST', body: JSON.stringify({ gate: 'video' }) });
        toast('Video cleared', 'ok');
        markCheck('video');
        closeDrawer();
        await refreshAll();
      } catch (e) { toast(e.message, 'err'); }
    });

    $('#btn-publish-now')?.addEventListener('click', async () => {
      const f = state.selectedFlight;
      if (!f) return;
      try {
        await saveEdit('publish');
        markCheck('publish');
        await api(`/flights/${encodeURIComponent(f.id)}/publish`, { method: 'POST', body: '{}' });
        toast('Depart triggered', 'ok');
        closeDrawer();
        setTimeout(refreshAll, 2000);
      } catch (e) { toast(e.message, 'err'); }
    });

    document.body.addEventListener('submit', async (e) => {
      if (e.target.id !== 'brand-form') return;
      e.preventDefault();
      const fd = new FormData(e.target);
      const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      try {
        await api('/brand', {
          method: 'PUT',
          body: JSON.stringify({
            brand: {
              audience: fd.get('audience'), vertical: fd.get('vertical'), tone: fd.get('tone'),
              cta: fd.get('cta'), primaryColor: fd.get('primaryColor'), logoUrl: fd.get('logoUrl'),
              phrasesUse: split(fd.get('phrasesUse')), phrasesAvoid: split(fd.get('phrasesAvoid')),
            },
            integrations: { voiceId: fd.get('voiceId'), sheetId: fd.get('sheetId'), creatomateTemplateId: fd.get('creatomateTemplateId') },
          }),
        });
        toast('Brand saved', 'ok');
        markCheck('brand');
        await refreshAll();
      } catch (err) { toast(err.message, 'err'); }
    });

    $('#btn-refresh-deck')?.addEventListener('click', refreshAll);

    // Help drawer
    $('#btn-help')?.addEventListener('click', openHelpDrawer);
    $('#help-drawer-close')?.addEventListener('click', closeHelpDrawer);
    $('#help-drawer-backdrop')?.addEventListener('click', closeHelpDrawer);

    // Onboarding checklist dismiss
    $('#onboard-dismiss')?.addEventListener('click', () => {
      document.getElementById('onboard-checklist')?.classList.add('onboard-checklist--collapsed');
    });

    // Guided tour controls
    $('#tour-next')?.addEventListener('click', () => {
      if (tourStep >= TOUR_STEPS.length - 1) { endTour(); return; }
      tourStep++;
      showTourStep(tourStep);
    });
    $('#tour-prev')?.addEventListener('click', () => {
      if (tourStep <= 0) return;
      tourStep--;
      showTourStep(tourStep);
    });
    $('#tour-skip')?.addEventListener('click', endTour);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  bindEvents();
  loadMe();
  refreshAll();
  setInterval(refreshAll, 30000);
})();
