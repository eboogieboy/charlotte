/*
 * Charlotte's Film Diary configuration.
 *
 * For cross-device sync, create a separate Supabase project, run supabase-schema.sql,
 * and paste its PROJECT URL and PUBLISHABLE (anon) KEY below. Both are public browser
 * configuration values. NEVER put a Supabase service_role or secret key in this file.
 *
 * The optional film lookup is read-only and independent of Charlotte's diary.
 */
window.CHARLOTTE_CONFIG = Object.freeze({
  syncUrl: '',
  syncPublishableKey: '',
  filmLookupUrl: 'https://hdbpyemnyvzaevrsjfqu.supabase.co',
  filmLookupPublishableKey: 'sb_publishable_LVfjHTKeB2pP2ibkTq2HhA_MgCcdAI-'
});