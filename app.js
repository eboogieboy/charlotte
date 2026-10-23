/* Charlotte's Film Diary — local-first front-end with optional independent cloud sync.
   The Winter Film Club TMDB proxy is used only for read-only movie lookup. */
(() => {
  'use strict';
  const C = window.CharlotteFilmCore;
  const STORAGE_KEY = 'charlottes-film-diary-v1';
  const config = window.CHARLOTTE_CONFIG || {};
  // Public, read-only movie lookup client — not the private diary database.
  const SUPABASE_URL = config.filmLookupUrl;
  const SUPABASE_PUBLISHABLE_KEY = config.filmLookupPublishableKey;
  const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w342';
  const $ = id => document.getElementById(id);
  let db = null;
  try { if (window.supabase) db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY); }
  catch (error) { console.warn('Film search could not be started:', error); }
  // Keep redundant copies, but never replace unreadable saved data with an empty diary.
  const BACKUP_KEY = STORAGE_KEY + '-last-good';
  const PREVIOUS_KEY = STORAGE_KEY + '-previous';
  const ARCHIVE_KEY = STORAGE_KEY + '-unreadable-archive';
  function decodeSnapshot(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.queue) || !Array.isArray(parsed.history)) {
      throw new Error('Saved film diary has an unexpected format.');
    }
    return C.normaliseState(parsed);
  }
  function initialDiary() {
    let primary, backup, previous;
    try {
      primary = localStorage.getItem(STORAGE_KEY);
      backup = localStorage.getItem(BACKUP_KEY);
      previous = localStorage.getItem(PREVIOUS_KEY);
    } catch (error) {
      return { state: C.fresh(), locked: true, message: 'Browser storage is unavailable. Do not add films here: they cannot be saved.' };
    }
    if (primary !== null) {
      try { return { state: decodeSnapshot(primary), locked: false, message: '' }; }
      catch (error) {
        for (const copy of [backup, previous]) {
          if (!copy) continue;
          try {
            return {
              state: decodeSnapshot(copy),
              locked: true,
              message: 'A local safety copy was found, but the main saved diary is unreadable. Your films are shown below. Export a backup, then import that file to repair your save. Do not clear this site’s data.'
            };
          } catch (_) { /* check another recovery copy */ }
        }
        return {
          state: C.fresh(), locked: true,
          message: 'Saved diary data is unreadable. It has NOT been replaced. Do not clear site data or add films; the original data may still be recoverable.'
        };
      }
    }
    for (const copy of [backup, previous]) {
      if (!copy) continue;
      try {
        return {
          state: decodeSnapshot(copy), locked: false,
          message: 'Your diary was recovered from a local safety copy. Export a backup now for safekeeping.'
        };
      } catch (_) { /* check another recovery copy */ }
    }
    return { state: C.fresh(), locked: false, message: '' };
  }
  const initial = initialDiary();
  let state = C.pickNext(initial.state);
  let storageLocked = initial.locked;
  let storageIssue = initial.message;
  let queryToken = 0;
  let timer = null;
  let editingId = null;
  let sort = 'recent';
  let cloud = null;

  const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  };
  const filmFacts = movie => [movie.year || null, movie.runtime ? `${movie.runtime} min` : null].filter(Boolean).join(' · ') || 'Movie night awaits';
  function toast(message, error = false) {
    const node = $('toast');
    node.textContent = message;
    node.className = 'feedback' + (error ? ' error' : '');
  }
  function persist() {
    if (storageLocked) throw new Error('Existing saved data needs attention. Export a backup before making changes.');
    const encoded = JSON.stringify(state);
    try {
      const old = localStorage.getItem(STORAGE_KEY);
      // Preserve a known-good copy before changing the primary record.
      if (old !== null && old !== encoded) {
        try { decodeSnapshot(old); }
        catch (_) { storageLocked = true; throw new Error('Existing saved data is unreadable. Nothing has been overwritten.'); }
        localStorage.setItem(PREVIOUS_KEY, old);
      }
      localStorage.setItem(STORAGE_KEY, encoded);
      if (localStorage.getItem(STORAGE_KEY) !== encoded) throw new Error('Save verification failed.');
      try { localStorage.setItem(BACKUP_KEY, encoded); }
      catch (error) { console.warn('Could not write the additional local backup:', error); }
      return true;
    } catch (error) {
      throw new Error('The phone could not save your film diary. ' + (error.message || 'Please export a backup.'));
    }
  }
  function commit(next) {
    const earlier = state;
    state = next;
    try { persist(); }
    catch (error) { state = earlier; render(); throw error; }
    render();
    if (cloud) cloud.changed();
  }
  function renderStorageWarning() {
    if (!storageIssue) return;
    const banner = node('aside','storage-warning');
    banner.setAttribute('role','alert');
    banner.append(node('strong','','Film diary storage notice'),node('p','',storageIssue));
    if (state.queue.length || state.history.length) {
      const backup = node('button','button dark','Export a safety backup');
      backup.type = 'button';
      backup.addEventListener('click', () => $('exportBtn').click());
      banner.append(backup);
    }
    document.querySelector('main').prepend(banner);
  }
  function node(tag, className, content) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content != null) item.textContent = String(content);
    return item;
  }
  function poster(movie, className = '') {
    const path = movie.posterPath || '';
    if (/^\/[a-zA-Z0-9_.\/-]+$/.test(path)) {
      const img = node('img', className);
      img.src = TMDB_IMAGE + path;
      img.alt = `${movie.title} poster`;
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(node('div', 'poster-empty', 'C ✦'));
      return img;
    }
    return node('div', 'poster-empty', 'C ✦');
  }
  function currentMovie() { return state.queue.find(movie => movie.id === state.currentId) || null; }
  function renderStats() {
    const s = C.stats(state);
    $('queuedCount').replaceChildren(document.createTextNode(String(s.queued) + ' '), node('small', '', '/ 20'));
    $('queueMeter').style.width = (100 * s.queued / C.MAX_QUEUE) + '%';
    $('watchedCount').textContent = String(s.watched);
    $('averageRating').textContent = s.average == null ? '—' : s.average.toFixed(1) + '/10';
    $('pickerStatus').textContent = state.started ? (state.currentId ? 'Ready to watch' : 'All caught up!') : `${s.needed} to go`;
    $('pickerNote').textContent = state.started ? 'One surprise at a time.' : 'Ten picks unlock the magic.';
    $('watchlistPill').textContent = `${s.queued} IN THE MIX`;
    const full = state.queue.length >= C.MAX_QUEUE;
    $('searchInput').disabled = full;
    $('searchButton').disabled = full;
    $('searchInput').placeholder = full ? 'Watchlist full — finish a film first' : 'Try Little Women, Interstellar, The Devil Wears Prada…';
    document.querySelector('#manualForm button[type=submit]').disabled = full;
  }
  function renderTonight() {
    const host = $('movieNightContent');
    host.replaceChildren();
    const movie = currentMovie();
    if (!movie) {
      const box = node('div', 'empty-show');
      box.append(node('div','empty-icon','✦'));
      const title = node('div','empty-big',state.started ? 'The screen is yours.' : 'The magic starts at ten.');
      box.append(title);
      box.append(node('p','',state.started ? 'You’ve seen every film in the hat. Add another whenever you’re ready, and we’ll pick your next movie night.' : 'Fill your watchlist with ten films and your first surprise pick will appear right here, all on its own.'));
      if (!state.started) {
        const s = C.stats(state);
        const track = node('div', 'progress-track');
        const bar = node('span'); bar.style.width = Math.min(100,100 * state.queue.length / C.START_AT) + '%'; track.append(bar);
        box.append(track, node('div','progress-label',`${state.queue.length} of ${C.START_AT} films picked · ${s.needed} to go`));
      }
      const link = node('a','button dark','+ Choose some films'); link.href = '#addFilm'; link.style.marginTop = '16px'; box.append(link);
      host.append(box);
      return;
    }
    const box = node('div','current-movie');
    box.append(poster(movie,'current-poster'));
    const details = node('div','current-details');
    details.append(node('div','film-ribbon','✦ TONIGHT’S SURPRISE PICK'));
    details.append(node('h3','',movie.title));
    details.append(node('p','movie-facts',filmFacts(movie)));
    if (movie.overview) details.append(node('p','overview',movie.overview));
    details.append(node('p','current-note','This pick is yours until you’ve watched and reviewed it. New additions can join the hat without changing tonight’s film.'));
    const buttons = node('div','current-buttons');
    const watched = node('button','button dark','✓ I’ve watched it — review'); watched.type = 'button'; watched.addEventListener('click',() => openReview(null));
    buttons.append(watched);
    details.append(buttons,node('p','watch-hint','Once you save your rating and review, the next film is picked automatically.'));
    box.append(details);
    host.append(box);
  }
  function renderQueue() {
    const host = $('watchlistGrid');host.replaceChildren();
    if (!state.queue.length) { host.append(node('div','section-empty','Your watchlist is empty. Add something brilliant (or brilliantly terrible) to get started.')); return; }
    for (const movie of state.queue) {
      const card = node('article','film-card' + (movie.id === state.currentId ? ' current' : ''));
      const cover = node('div','cover-wrap'); cover.append(poster(movie));
      if (movie.id === state.currentId) cover.append(node('span','card-tag','TONIGHT’S PICK'));
      card.append(cover,node('h3','',movie.title),node('p','',filmFacts(movie)));
      const remove = node('button','remove-film','Remove from list');remove.type = 'button';
      remove.setAttribute('aria-label',`Remove ${movie.title} from watchlist`);
      remove.addEventListener('click',() => {
        if (!window.confirm(`Remove “${movie.title}” from the watchlist?${movie.id === state.currentId ? ' A new pick will be chosen.' : ''}`)) return;
        try {commit(C.removeMovie(state,movie.id));toast(`${movie.title} removed from your watchlist.`);} catch(e){toast(e.message,true);}
      });
      card.append(remove);host.append(card);
    }
  }
  function renderHistory() {
    const host = $('reviewGrid');host.replaceChildren();
    if (!state.history.length) { host.append(node('div','section-empty','The credits haven’t rolled on any reviews yet. Your first film verdict will appear here.'));return; }
    const films = [...state.history];
    if (sort === 'rating') films.sort((a,b)=>b.rating-a.rating || b.watchedAt.localeCompare(a.watchedAt));
    if (sort === 'oldest') films.reverse();
    for (const movie of films) {
      const card = node('article','review-film');
      const cover = node('div','review-cover');cover.append(poster(movie));
      const content = node('div');
      content.append(node('h3','',movie.title),node('span','review-date',`${filmFacts(movie)} · Watched ${formatDate(movie.watchedAt)}`),node('p','',movie.review));
      const actions = node('div'); const badge = node('div','score-badge');badge.append(document.createTextNode(String(movie.rating)),node('small','',' / 10'));
      const edit = node('button','edit-review','Edit review');edit.type='button';edit.addEventListener('click',() => openReview(movie.id));
      actions.append(badge,edit);card.append(cover,content,actions);host.append(card);
    }
  }
  function render() {renderStats();renderTonight();renderQueue();renderHistory();}

  function openReview(id) {
    editingId = id;
    const movie = id ? state.history.find(m => m.id === id) : currentMovie();
    if (!movie) return;
    $('reviewFilmName').textContent = `${movie.title}${movie.year ? ` (${movie.year})` : ''}`;
    $('reviewTitle').textContent = id ? 'Change your verdict.' : 'How was it?';
    $('ratingInput').value = String(id ? movie.rating : 7);
    $('ratingOutput').textContent = $('ratingInput').value + '/10';
    $('reviewText').value = id ? movie.review : '';
    $('reviewError').textContent = '';
    document.querySelector('#reviewForm button[type=submit]').textContent = id ? 'Save updated review' : 'Save review & pick the next →';
    $('reviewDialog').showModal();
  }
  const closeReview = () => $('reviewDialog').close();
  $('reviewForm').addEventListener('submit',event => {
    event.preventDefault();
    const score = Number($('ratingInput').value), review = $('reviewText').value;
    try {
      const next = editingId ? C.editReview(state,editingId,score,review) : C.finishCurrent(state,score,review);
      const edited = Boolean(editingId);
      commit(next);
      closeReview();
      toast(edited ? 'Review updated.' : 'Review saved — your next film is ready!');
      if (!edited) $('movieNight').scrollIntoView({ behavior:'smooth' });
    } catch(e) { $('reviewError').textContent = e.message; }
  });
  $('ratingInput').addEventListener('input',() => $('ratingOutput').textContent = $('ratingInput').value + '/10');
  $('closeReview').addEventListener('click',closeReview);
  $('cancelReview').addEventListener('click',closeReview);
  $('reviewDialog').addEventListener('click',event => {if (event.target === $('reviewDialog')) closeReview();});
  $('reviewSort').addEventListener('change',event => {sort = event.target.value;renderHistory();});

  async function filmLookup(query) {
    if (!db) throw new Error('Search is unavailable right now. You can still add films manually below.');
    const { data, error } = await db.functions.invoke('tmdb-proxy',{body:{action:'search',query}});
    if (error || (data && data.error)) throw new Error('Search is unavailable right now. You can still add films manually below.');
    return (Array.isArray(data && data.results) ? data.results : []).slice(0,7);
  }
  async function filmDetails(result) {
    if (!db) return result;
    try {
      const {data,error} = await db.functions.invoke('tmdb-proxy',{body:{action:'details',id:result.id}});
      if (!error && data && !data.error) return { ...result, ...data };
    } catch (error) {console.warn('Extra film details unavailable:',error);}
    return result;
  }
  function clearResults() { $('searchResults').replaceChildren(); }
  async function doSearch() {
    clearTimeout(timer);
    const query = $('searchInput').value.trim();
    const own = ++queryToken;
    const host = $('searchResults');host.replaceChildren();
    if (query.length < 2) {if(query.length) host.append(node('div','search-info','Type at least two characters to search.'));return;}
    if (state.queue.length >= C.MAX_QUEUE) return;
    host.append(node('div','search-info','Looking through the film shelves…'));
    try {
      const results = await filmLookup(query);
      if (own !== queryToken) return;
      host.replaceChildren();
      if (!results.length) {host.append(node('div','search-info','No matches found. Try another spelling or add the title yourself.'));return;}
      for (const result of results) {
        const year = result.release_date ? String(result.release_date).slice(0,4) : '';
        const temp = {title:result.title || result.original_title || 'Untitled',year,posterPath:result.poster_path || '',overview:result.overview || ''};
        const option = node('button','search-item');option.type='button';
        option.append(poster(temp),node('span','search-copy'),node('span','add-plus','+'));
        option.querySelector('.search-copy').append(node('strong','',temp.title),node('small','',year || 'Year unknown'));
        option.setAttribute('aria-label',`Add ${temp.title}${year ? ` (${year})` : ''} to watchlist`);
        option.addEventListener('click',async() => {
          if(state.queue.length >= C.MAX_QUEUE) {toast('Watchlist full. Finish a film first.',true);return;}
          option.disabled=true;
          option.querySelector('.add-plus').textContent='…';
          const detail = await filmDetails(result);
          const m = {tmdbId:detail.id || result.id,title:detail.title || temp.title,year:String(detail.release_date || result.release_date || '').slice(0,4),runtime:detail.runtime || null,posterPath:detail.poster_path || result.poster_path || '',overview:detail.overview || result.overview || ''};
          try {commit(C.addMovie(state,m));$('searchInput').value='';clearResults();toast(`Added “${m.title}” to Charlotte’s watchlist.`);}
          catch(e) {toast(e.message,true);option.disabled=false;option.querySelector('.add-plus').textContent='+';}
        });
        host.append(option);
      }
    } catch(error) {
      if (own !== queryToken) return;
      host.replaceChildren();host.append(node('div','search-info error',error.message));
    }
  }
  $('searchButton').addEventListener('click',doSearch);
  $('searchInput').addEventListener('input',()=> { clearTimeout(timer);const token = ++queryToken;if(!$('searchInput').value.trim()){clearResults();return;} timer = setTimeout(()=> {if(token === queryToken) doSearch();},420); });
  $('searchInput').addEventListener('keydown',event => {if(event.key === 'Enter') {event.preventDefault();doSearch();}});
  $('toggleManual').addEventListener('click',() => {$('manualForm').classList.toggle('hidden');$('toggleManual').textContent = $('manualForm').classList.contains('hidden') ? 'Add it yourself instead →' : 'Hide manual entry ↑';});
  $('manualForm').addEventListener('submit',event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {const title = String(values.get('title') || '').trim();const year = String(values.get('year') || '').trim();
      if (year && !/^\d{4}$/.test(year)) throw new Error('Please enter a four-digit release year.');
      commit(C.addMovie(state,{title,year}));event.currentTarget.reset();toast(`Added “${title}” to Charlotte’s watchlist.`);
    } catch(e) {toast(e.message,true);}
  });
  $('exportBtn').addEventListener('click',() => {
    const blob = new Blob([JSON.stringify({app:'charlottes-film-diary', exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);const a = document.createElement('a');a.href=url;a.download=`charlottes-film-diary-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=> URL.revokeObjectURL(url),1000);
  });
  $('importBtn').addEventListener('click',()=> $('importFile').click());
  $('importFile').addEventListener('change',async event => {
    const file = event.target.files && event.target.files[0];event.target.value='';if(!file) return;
    if (file.size > 2_000_000) {toast('That backup is too large to import.',true);return;}
    try {
      const payload = JSON.parse(await file.text());
      if (payload.app !== 'charlottes-film-diary' || !payload.state || !Array.isArray(payload.state.queue) || !Array.isArray(payload.state.history)) throw new Error('This does not look like a Charlotte’s Film Diary backup.');
      if (!window.confirm('Import this backup? It will replace the films and reviews currently saved in this browser.')) return;
      // Import is an explicit repair action. First preserve any unreadable original bytes.
      if (storageLocked) {
        try {
          const unreadable = localStorage.getItem(STORAGE_KEY);
          if (unreadable !== null) {
            // Store the unreadable record untouched before an explicitly approved import.
            localStorage.setItem(ARCHIVE_KEY, unreadable);
            localStorage.removeItem(STORAGE_KEY);
          }
          storageLocked = false;
        } catch (error) { throw new Error('Cannot repair this browser’s storage. No data was overwritten.'); }
      }
      commit(C.pickNext(C.normaliseState(payload.state)));
      document.querySelector('.storage-warning')?.remove();
      storageIssue = '';
      toast('Backup imported. Your diary is ready.');
    } catch(e) {toast(e.message || 'Could not read that backup.',true);}
  });
  const syncColors = { online: 'online', working: 'working', offline: 'offline', 'signed-out': 'local', 'link-sent': 'working', local: 'local' };
  function syncStatus(mode, message, detail) {
    $('syncStatus').textContent = message;
    $('syncDetail').textContent = detail;
    $('syncDot').className = 'sync-dot ' + (syncColors[mode] || 'local');
    const canSignIn = cloud && cloud.configured && mode !== 'online' && mode !== 'working' && mode !== 'offline';
    $('syncForm').classList.toggle('hidden', !canSignIn);
    $('syncSignOut').classList.toggle('hidden', !(cloud && cloud.configured && (mode === 'online' || mode === 'offline' || mode === 'working')));
  }
  if (window.CharlotteSync) {
    cloud = window.CharlotteSync.create({
      config, sdk: window.supabase,
      getLocal: () => state,
      applyRemote: next => { state = C.pickNext(C.normaliseState(next)); persist(); render(); },
      status: syncStatus,
      ask: message => window.confirm(message)
    });
  }
  $('syncForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!cloud || !cloud.signIn) return;
    const button = $('syncForm').querySelector('button[type=submit]');
    button.disabled = true;
    try { await cloud.signIn($('syncEmail').value.trim()); }
    catch (error) { toast(error.message || 'Could not send the sign-in link.', true); }
    finally { button.disabled = false; }
  });
  $('syncSignOut').addEventListener('click', async () => {
    if (!cloud || !cloud.signOut) return;
    try { await cloud.signOut(); toast('Signed out of cloud sync. Your local film diary stays on this device.'); }
    catch (error) {toast(error.message || 'Could not sign out.', true);}
  });
  // Never save on startup: an unreadable record must not be replaced by a blank state.
  render();
  renderStorageWarning();
  if (cloud) { cloud.start(); }
})();