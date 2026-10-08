/* Charlotte's Film Diary — pure state transitions. No external dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CharlotteFilmCore = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const START_AT = 10;
  const MAX_QUEUE = 20;
  const MAX_REVIEW = 500;

  const fresh = () => ({ version: 1, started: false, queue: [], currentId: null, history: [] });
  const text = (value, max = 1000) => String(value == null ? '' : value).trim().slice(0, max);
  const movieKey = movie => movie && movie.tmdbId ? `tmdb:${movie.tmdbId}` : `title:${text(movie && movie.title).toLowerCase()}|${text(movie && movie.year)}`;
  const sameMovie = (a, b) => movieKey(a) === movieKey(b) || (text(a && a.title).toLowerCase() === text(b && b.title).toLowerCase() && (!text(a && a.year) || !text(b && b.year) || text(a && a.year) === text(b && b.year))); 
  function normaliseMovie(movie) {
    if (!movie || !text(movie.title)) throw new Error('Please enter a film title.');
    const posterPath = text(movie.posterPath || movie.poster_path, 250);
    return {
      id: text(movie.id, 150) || movieKey(movie),
      tmdbId: movie.tmdbId ? String(movie.tmdbId) : null,
      title: text(movie.title, 180),
      year: text(movie.year, 4),
      posterPath: /^\/[a-zA-Z0-9_.\/-]+$/.test(posterPath) ? posterPath : '',
      runtime: Number.isFinite(Number(movie.runtime)) && Number(movie.runtime) > 0 ? Math.round(Number(movie.runtime)) : null,
      overview: text(movie.overview, 1500),
      addedAt: text(movie.addedAt, 40) || new Date().toISOString()
    };
  }
  function normaliseState(raw) {
    if (!raw || typeof raw !== 'object') return fresh();
    const queue = Array.isArray(raw.queue) ? raw.queue : [];
    const history = Array.isArray(raw.history) ? raw.history : [];
    const used = new Set();
    const keptQueue = [];
    for (const rawMovie of queue) {
      try {
        const movie = normaliseMovie(rawMovie);
        const key = movieKey(movie);
        if (!used.has(key) && keptQueue.length < MAX_QUEUE) { used.add(key); keptQueue.push(movie); }
      } catch (_) { /* skip invalid saved films */ }
    }
    const keptHistory = [];
    for (const item of history) {
      try {
        const movie = normaliseMovie(item);
        const key = movieKey(movie);
        const rating = Number(item.rating);
        if (used.has(key) || !Number.isInteger(rating) || rating < 1 || rating > 10) continue;
        used.add(key);
        keptHistory.push({ ...movie, rating, review: text(item.review, MAX_REVIEW), watchedAt: text(item.watchedAt, 40) });
      } catch (_) { /* skip malformed reviews */ }
    }
    const started = !!raw.started || keptHistory.length > 0 || keptQueue.length >= START_AT;
    const currentId = keptQueue.some(m => m.id === raw.currentId) ? raw.currentId : null;
    return { version: 1, started, queue: keptQueue, currentId, history: keptHistory };
  }
  const clone = state => ({ ...state, queue: [...state.queue], history: [...state.history] });
  function pickNext(raw, random = Math.random) {
    const state = clone(normaliseState(raw));
    if (!state.started && state.queue.length >= START_AT) state.started = true;
    if (!state.started || state.currentId || !state.queue.length) return state;
    const x = Number(random());
    const r = Number.isFinite(x) ? Math.min(0.999999999, Math.max(0, x)) : 0;
    state.currentId = state.queue[Math.floor(r * state.queue.length)].id;
    return state;
  }
  function addMovie(raw, movie, random = Math.random) {
    const state = clone(normaliseState(raw));
    if (state.queue.length >= MAX_QUEUE) throw new Error('The watchlist is full. Finish a film or remove a pick first.');
    const incoming = normaliseMovie(movie);
    const key = movieKey(incoming);
    if ([...state.queue, ...state.history].some(m => sameMovie(m, incoming))) throw new Error('That film is already on your list or in your diary.');
    // Normalise the ID to one stable key to preserve references across reloads.
    incoming.id = key;
    state.queue.push(incoming);
    return pickNext(state, random);
  }
  function removeMovie(raw, id, random = Math.random) {
    const state = clone(normaliseState(raw));
    if (!state.queue.some(m => m.id === id)) throw new Error('Film not found.');
    state.queue = state.queue.filter(m => m.id !== id);
    if (state.currentId === id) state.currentId = null;
    return pickNext(state, random);
  }
  function finishCurrent(raw, rating, review, random = Math.random, when = new Date().toISOString()) {
    const state = clone(normaliseState(raw));
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('Give this film a score from 1 to 10.');
    const written = text(review, MAX_REVIEW);
    if (!written) throw new Error('Write a quick review before continuing.');
    if (!state.currentId) throw new Error('There is no current film to review.');
    const movie = state.queue.find(m => m.id === state.currentId);
    if (!movie) throw new Error('Current film not found.');
    state.queue = state.queue.filter(m => m.id !== state.currentId);
    state.history = [{ ...movie, rating: n, review: written, watchedAt: when }, ...state.history];
    state.currentId = null;
    return pickNext(state, random);
  }
  function editReview(raw, id, rating, review) {
    const state = clone(normaliseState(raw));
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('Give this film a score from 1 to 10.');
    const written = text(review, MAX_REVIEW);
    if (!written) throw new Error('Write a quick review.');
    if (!state.history.some(m => m.id === id)) throw new Error('Review not found.');
    state.history = state.history.map(m => m.id === id ? { ...m, rating: n, review: written } : m);
    return state;
  }
  function stats(raw) {
    const state = normaliseState(raw);
    const count = state.history.length;
    return { queued: state.queue.length, watched: count, average: count ? state.history.reduce((sum, m) => sum + m.rating, 0) / count : null, needed: Math.max(0, START_AT - state.queue.length) };
  }
  return { START_AT, MAX_QUEUE, MAX_REVIEW, fresh, normaliseMovie, normaliseState, movieKey, pickNext, addMovie, removeMovie, finishCurrent, editReview, stats };
});