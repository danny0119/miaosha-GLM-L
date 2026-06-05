import { storage } from '#imports';
import type { AuthHeaders } from './types';

export interface AccountCredentials {
  username: string;
  password: string;
}

export interface Account {
  id: string;
  username: string;
  createdAt: number;
}

const ACCOUNTS_KEY = 'local:hubAccounts';

export function authHeadersKey(accountId: string): string {
  return `local:authHeaders:${accountId}`;
}

export function ticketPoolKey(accountId: string): string {
  return `local:ticketPool:${accountId}`;
}

export function credentialsKey(accountId: string): string {
  return `local:credentials:${accountId}`;
}

export async function listAccounts(): Promise<Account[]> {
  return (await storage.getItem<Account[]>(ACCOUNTS_KEY)) ?? [];
}

export async function addAccount(username: string): Promise<Account> {
  const accounts = await listAccounts();
  const nextIndex = accounts.length + 1;
  const id = `acct_${nextIndex}`;
  const account: Account = { id, username, createdAt: Date.now() };
  accounts.push(account);
  await storage.setItem(ACCOUNTS_KEY, accounts);
  return account;
}

export async function deleteAccount(id: string): Promise<void> {
  let accounts = await listAccounts();
  accounts = accounts.filter(a => a.id !== id);
  accounts = accounts.map((a, i) => ({ ...a, id: `acct_${i + 1}` }));
  await storage.setItem(ACCOUNTS_KEY, accounts);
  const oldKeys = [authHeadersKey(id), ticketPoolKey(id), credentialsKey(id)];
  await Promise.all(oldKeys.map(k => storage.removeItem(k)));
}

export async function updateAccount(id: string, username: string): Promise<void> {
  const accounts = await listAccounts();
  const idx = accounts.findIndex(a => a.id === id);
  if (idx !== -1) {
    accounts[idx].username = username;
    await storage.setItem(ACCOUNTS_KEY, accounts);
  }
}

export async function setAuthHeaders(accountId: string, headers: AuthHeaders): Promise<void> {
  await storage.setItem(authHeadersKey(accountId), headers);
}

export async function getAuthHeaders(accountId: string): Promise<AuthHeaders | null> {
  return await storage.getItem<AuthHeaders>(authHeadersKey(accountId));
}

export async function setCredentials(accountId: string, creds: AccountCredentials): Promise<void> {
  await storage.setItem(credentialsKey(accountId), creds);
}

export async function getCredentials(accountId: string): Promise<AccountCredentials | null> {
  return await storage.getItem<AccountCredentials>(credentialsKey(accountId));
}
