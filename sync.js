/* Charlotte's Film Diary — opt-in, authenticated, revision-checked cloud sync.
 * Requires a separate Supabase project with supabase-schema.sql applied.
 * Offline changes stay on this device until a connection is restored.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CharlotteSync = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const META_KEY = 'charlottes-film-diary-sync-v1';
  const DIRTY_KEY = 'charlottes-film-diary-dirty-v1';
  const hasContent = data => !!(data && ((data.queue || []).length || (data.history || []).length));
  const sameState = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function isConfigured(config) {
    return !!(config && /^https:\/\/[\w.-]+\.supabase\.co\/?$/.test(config.syncUrl || '') &&
      /^(sb_publishable_|eyJ)/.test(config.syncPublishableKey || ''));
  }
  function create({ config, sdk, getLocal, applyRemote, status, ask }) {
    if (!isConfigured(config) || !sdk) {
      status('local', 'Stored on this device', 'Cloud syncing will be available once a separate Supabase project is connected.');
      return { configured: false, changed() {}, refresh() {}, start() {} };
    }
    const db = sdk.createClient(config.syncUrl, config.syncPublishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    let user = null, revision = null, running = false, pendingTimer = null;
    let initializedUser = null;
    let meta;
    try { meta = JSON.parse(localStorage.getItem(META_KEY) || 'null') || {}; }
    catch (_) { meta = {}; }
    let dirty = localStorage.getItem(DIRTY_KEY) === '1';
    const setDirty = value => { dirty = value; localStorage.setItem(DIRTY_KEY, value ? '1' : '0'); };
    const setRevision = value => {
      revision = Number(value);
      meta = { userId: user.id, revision };
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    };
    const report = (state, message, detail) => status(state, message, detail, user && user.email);
    const errText = err => err && err.message ? err.message : 'Could not connect to cloud storage.';
    const readRemote = async () => {
      const { data, error } = await db.from('charlotte_diaries').select('data,revision').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return data;
    };
    const loadCloud = remote => {
      applyRemote(remote.data);
      setRevision(remote.revision);
      setDirty(false);
      report('online', 'Synced across devices', 'Your watchlist and reviews are up to date.');
    };
    async function push() {
      if (!user || running || !dirty || revision === null) return;
      running = true;
      report('working', 'Saving changes…', 'Your diary is backed up locally while syncing.');
      try {
        const snapshot = getLocal();
        const version = revision;
        const { data, error } = await db.from('charlotte_diaries')
          .update({ data: snapshot, revision: version + 1, updated_at: new Date().toISOString() })
          .eq('user_id', user.id).eq('revision', version).select('revision').maybeSingle();
        if (error) throw error;
        if (!data) {
          const newer = await readRemote();
          if (!newer) throw new Error('Cloud diary missing. Sign out and back in to reconnect.');
          const keepDevice = ask('Your film diary was changed on another device.\n\nOK = keep THIS device’s changes and replace the cloud copy.\nCancel = use the CLOUD copy instead.\n\nExport a backup first if you are unsure.');
          if (keepDevice) {
            setRevision(newer.revision);
            report('working', 'Resolving changes…', 'Saving this device’s chosen version.');
          } else {
            loadCloud(newer);
          }
          return;
        }
        setRevision(data.revision);
        if (sameState(snapshot, getLocal())) setDirty(false);
        report(dirty ? 'working' : 'online', dirty ? 'More changes to save…' : 'Synced across devices',
          dirty ? 'Finishing the latest changes.' : 'Your latest films and reviews are saved.');
      } catch (error) {
        report('offline', 'Changes saved on this device', `${errText(error)} We’ll retry the cloud save when connected.`);
      } finally {
        running = false;
        if (dirty && user && !pendingTimer) schedule(30000);
      }
    }
    function schedule(delay = 400) {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pendingTimer = null; push(); }, delay);
    }
    async function refresh() {
      if (!user || running || dirty) return;
      try {
        const remote = await readRemote();
        if (remote && Number(remote.revision) > Number(revision)) loadCloud(remote);
      } catch (error) {
        report('offline', 'Cloud temporarily unavailable', `${errText(error)} Your saved films are still on this device.`);
      }
    }
    async function attach(nextUser) {
      if (!nextUser) {
        user = null; revision = null; initializedUser = null;
        report('signed-out', 'Sign in for cloud sync', 'Use the same email address on your phone and computer.');
        return;
      }
      if (initializedUser === nextUser.id) return;
      user = nextUser; initializedUser = nextUser.id;
      report('working', 'Connecting your diary…', 'Checking your latest saved films.');
      try {
        const remote = await readRemote();
        if (!remote) {
          const snapshot = getLocal();
          const { data, error } = await db.from('charlotte_diaries')
            .insert({ user_id: user.id, data: snapshot, revision: 1 })
            .select('revision').single();
          if (error) {
            // A concurrent login may have created the row: read it instead.
            const created = await readRemote();
            if (!created) throw error;
            initializedUser = null;
            await attach(nextUser);
            return;
          }
          setRevision(data.revision);
          setDirty(false);
          report('online', 'Synced across devices', 'Your diary has been saved to your personal cloud account.');
          return;
        }
        const local = getLocal();
        const alreadyPaired = meta.userId === user.id;
        const changedSinceLastSync = dirty && alreadyPaired;
        const firstPairWithContent = !alreadyPaired && hasContent(local);
        const differs = !sameState(local, remote.data);
        if ((changedSinceLastSync || firstPairWithContent) && differs) {
          const keepDevice = ask('We found different film diaries on this device and in the cloud.\n\nOK = upload THIS device’s films and reviews.\nCancel = download the CLOUD diary.\n\nExport a backup first if you need to keep both.');
          if (keepDevice) {
            setRevision(remote.revision);
            setDirty(true);
            schedule(0);
            return;
          }
        }
        loadCloud(remote);
      } catch (error) {
        initializedUser = null;
        report('offline', 'Unable to start cloud sync', `${errText(error)} Your local diary has not been lost.`);
      }
    }
    async function signIn(email) {
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      const redirect = window.location.origin + window.location.pathname;
      const { error } = await db.auth.signInWithOtp({email, options: {emailRedirectTo: redirect}});
      if (error) throw error;
      report('link-sent', 'Check your email', 'Open the sign-in link on the device you want to sync.');
    }
    async function signOut() {
      const { error } = await db.auth.signOut();
      if (error) throw error;
      await attach(null);
    }
    function changed() {
      setDirty(true);
      if (user) {
        report('working', 'Saving changes…', 'Your film is saved locally and queued for cloud sync.');
        schedule();
      } else report('signed-out', 'Saved locally — not synced yet', 'Sign in to keep your changes across devices.');
    }
    function start() {
      report('working', 'Checking sign-in…', 'Connecting to your private cloud diary.');
      db.auth.onAuthStateChange((event, session) => {
        // Defer Supabase DB requests until outside of the auth event callback.
        setTimeout(() => { attach(session && session.user).catch(console.error); }, 0);
      });
      window.addEventListener('focus', refresh);
      window.addEventListener('online', () => { if (dirty) schedule(0); else refresh(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
      setInterval(refresh, 45000);
    }
    return {configured: true, start, changed, refresh, signIn, signOut};
  }
  return {create, isConfigured, hasContent, sameState};
});