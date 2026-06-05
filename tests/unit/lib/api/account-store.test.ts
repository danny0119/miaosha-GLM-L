import { describe, it, expect } from 'vitest';
import {
  addAccount,
  listAccounts,
  deleteAccount,
  updateAccount,
  setAuthHeaders,
  getAuthHeaders,
  setCredentials,
  getCredentials,
} from '../../../../lib/api/account-store';
import { fakeBrowser } from 'wxt/testing/fake-browser';

describe('account-store', () => {
  describe('listAccounts / addAccount', () => {
    it('starts with an empty list', async () => {
      expect(await listAccounts()).toEqual([]);
    });

    it('adds an account and returns it with generated id', async () => {
      const acct = await addAccount('test-user');
      expect(acct.username).toBe('test-user');
      expect(acct.id).toBe('acct_1');
      expect(acct.createdAt).toBeGreaterThan(0);

      const list = await listAccounts();
      expect(list).toHaveLength(1);
      expect(list[0].username).toBe('test-user');
    });

    it('assigns sequential ids', async () => {
      const a1 = await addAccount('user1');
      expect(a1.id).toBe('acct_1');
      const a2 = await addAccount('user2');
      expect(a2.id).toBe('acct_2');
    });
  });

  describe('deleteAccount', () => {
    it('removes the account and renumbers remaining ids', async () => {
      await addAccount('user1');
      await addAccount('user2');
      await addAccount('user3');

      await deleteAccount('acct_2');

      const list = await listAccounts();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('acct_1');
      expect(list[0].username).toBe('user1');
      expect(list[1].id).toBe('acct_2');
      expect(list[1].username).toBe('user3');
    });

    it('removes associated storage keys', async () => {
      await addAccount('u1');
      await setAuthHeaders('acct_1', { authorization: 'Bearer tok', bigmodelOrganization: 'org', bigmodelProject: 'proj' });
      await setCredentials('acct_1', { username: 'u1', password: 'p1' });

      await deleteAccount('acct_1');

      expect(await getAuthHeaders('acct_1')).toBeNull();
      expect(await listAccounts()).toEqual([]);
    });
  });

  describe('updateAccount', () => {
    it('renames the account', async () => {
      await addAccount('old-name');
      await updateAccount('acct_1', 'new-name');

      const list = await listAccounts();
      expect(list[0].username).toBe('new-name');
    });
  });

  describe('auth headers per account', () => {
    it('set/get round-trips auth headers', async () => {
      const headers = { authorization: 'Bearer tok1', bigmodelOrganization: 'org1', bigmodelProject: 'proj1' };
      await setAuthHeaders('acct_1', headers);

      const got = await getAuthHeaders('acct_1');
      expect(got).toEqual(headers);
    });

    it('returns null for unknown account', async () => {
      expect(await getAuthHeaders('acct_nonexistent')).toBeNull();
    });
  });

  describe('credentials per account', () => {
    it('set/get round-trips credentials', async () => {
      await setCredentials('acct_1', { username: 'user', password: 'pass' });

      const got = await getCredentials('acct_1');
      expect(got).toEqual({ username: 'user', password: 'pass' });
    });

    it('returns null for unknown account', async () => {
      expect(await getCredentials('acct_nonexistent')).toBeNull();
    });
  });
});
