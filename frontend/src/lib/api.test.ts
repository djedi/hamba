import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthError, api } from './api';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('api', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('AuthError', () => {
		it('creates error with message', () => {
			const error = new AuthError('Session expired');
			expect(error.message).toBe('Session expired');
			expect(error.name).toBe('AuthError');
			expect(error.needsReauth).toBe(false);
		});

		it('creates error with needsReauth flag', () => {
			const error = new AuthError('Session expired', true);
			expect(error.needsReauth).toBe(true);
		});
	});

	describe('api.getAccounts', () => {
		it('fetches accounts successfully', async () => {
			const mockAccounts = [
				{ id: '1', email: 'test@test.com', name: 'Test', provider_type: 'gmail' }
			];
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockAccounts)
			});

			const accounts = await api.getAccounts();

			expect(accounts).toEqual(mockAccounts);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/auth/accounts',
				expect.objectContaining({
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' }
				})
			);
		});

		it('throws on API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500
			});

			await expect(api.getAccounts()).rejects.toThrow('API error: 500');
		});

		it('throws AuthError when needsReauth is true', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ needsReauth: true, error: 'Token expired' })
			});

			await expect(api.getAccounts()).rejects.toThrow(AuthError);
		});
	});

	describe('api.getEmails', () => {
		it('fetches emails with default pagination', async () => {
			const mockEmails = [{ id: '1', subject: 'Test' }];
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockEmails)
			});

			const emails = await api.getEmails('account-1');

			expect(emails).toEqual(mockEmails);
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails?accountId=account-1&limit=50&offset=0',
				expect.any(Object)
			);
		});

		it('fetches emails with custom pagination', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve([])
			});

			await api.getEmails('account-1', 25, 10);

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails?accountId=account-1&limit=25&offset=10',
				expect.any(Object)
			);
		});
	});

	describe('api.searchEmails', () => {
		it('encodes query parameter', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve([])
			});

			await api.searchEmails('test query');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/search?q=test%20query&limit=50',
				expect.any(Object)
			);
		});

		it('handles special characters in query', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve([])
			});

			await api.searchEmails('from:test@example.com');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/search?q=from%3Atest%40example.com&limit=50',
				expect.any(Object)
			);
		});
	});

	describe('api.syncEmails', () => {
		it('calls sync endpoint with POST', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ synced: 10, total: 100 })
			});

			const result = await api.syncEmails('account-1');

			expect(result).toEqual({ synced: 10, total: 100 });
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/sync/account-1',
				expect.objectContaining({ method: 'POST' })
			);
		});
	});

	describe('email action methods', () => {
		it('markRead calls correct endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.markRead('email-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/email-1/read',
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('markUnread calls correct endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.markUnread('email-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/email-1/unread',
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('star calls correct endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.star('email-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/email-1/star',
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('unstar calls correct endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.unstar('email-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/email-1/unstar',
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('archive calls correct endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.archive('email-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/email-1/archive',
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('trash calls correct endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.trash('email-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/email-1/trash',
				expect.objectContaining({ method: 'POST' })
			);
		});
	});

	describe('api.sendEmail', () => {
		it('sends email with correct parameters', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: true, messageId: 'msg-123' })
			});

			const params = {
				accountId: 'acc-1',
				to: 'recipient@test.com',
				subject: 'Test Subject',
				body: 'Test body'
			};

			const result = await api.sendEmail(params);

			expect(result).toEqual({ success: true, messageId: 'msg-123' });
			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/emails/send',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify(params)
				})
			);
		});
	});

	describe('api.getLoginUrl', () => {
		it('returns correct login URL', () => {
			expect(api.getLoginUrl()).toBe('http://localhost:3001/auth/login');
		});
	});

	describe('api.deleteAccount', () => {
		it('calls delete endpoint', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({})
			});

			await api.deleteAccount('acc-1');

			expect(mockFetch).toHaveBeenCalledWith(
				'http://localhost:3001/auth/accounts/acc-1',
				expect.objectContaining({ method: 'DELETE' })
			);
		});
	});
});
