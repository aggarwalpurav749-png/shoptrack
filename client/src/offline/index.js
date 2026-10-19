// Entry point of the offline engine.
import { setLocalHandler } from '../lib/api.js';
import { store } from './store.js';
import { handleLocal } from './local.js';
import { startSync, stopSync, runSync, refreshSyncState } from './sync.js';
import { emit } from './events.js';

let initPromise = null;
export const initOffline = () => {
  if (!initPromise) {
    initPromise = store.init().then(() => {
      setLocalHandler(handleLocal, () => emit('kick'));
      refreshSyncState();
    });
  }
  return initPromise;
};

/** Called after a successful login / app start with a saved login. */
export async function attachUser(user) {
  await initOffline();
  const owner = store.kvGet('owner');
  if (owner && owner !== user.id) {
    if (store.outbox().length || store.pings().length) {
      throw new Error('This device still has unsynced work from another account. Log in with that account once to send it first.');
    }
    await store.wipe();
  }
  store.kvSet('owner', user.id);
  store.kvSet('user', user);
  startSync();
}

/** Log out only when nothing is left unsent; then forget the shop data on this device. */
export async function detachUser() {
  await runSync();
  if (store.outbox().length || store.pings().length) {
    return { ok: false, message: 'Some work is not sent to the server yet. Connect to the internet and wait for sync, then log out.' };
  }
  stopSync();
  await store.wipe();
  return { ok: true };
}

export { store };
