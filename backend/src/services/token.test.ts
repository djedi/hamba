import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { tokenNeedsRefresh, getValidAccessToken } from './token';

// Mock the db module
const mockGetById = mock(() => null);

mock.module('../db', () => ({
	accountQueries: {
		getById: {
			get: mockGetById
		},
		upsert: {
			run: mock(() => {})
		}
	}
}));

describe('token service', () => {
	beforeEach(() => {
		mockGetById.mockReset();
	});

	describe('tokenNeedsRefresh', () => {
		it('returns false when account does not exist', () => {
			mockGetById.mockReturnValue(null);

			const result = tokenNeedsRefresh('nonexistent-id');

			expect(result).toBe(false);
		});

		it('returns true when token_expires_at is not set', () => {
			mockGetById.mockReturnValue({
				id: 'acc-1',
				email: 'test@test.com',
				token_expires_at: null
			});

			const result = tokenNeedsRefresh('acc-1');

			expect(result).toBe(true);
		});

		it('returns true when token is expired', () => {
			const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
			mockGetById.mockReturnValue({
				id: 'acc-1',
				email: 'test@test.com',
				token_expires_at: pastTime
			});

			const result = tokenNeedsRefresh('acc-1');

			expect(result).toBe(true);
		});

		it('returns true when token expires within buffer (5 minutes)', () => {
			const soonTime = Math.floor(Date.now() / 1000) + 60; // 1 minute from now
			mockGetById.mockReturnValue({
				id: 'acc-1',
				email: 'test@test.com',
				token_expires_at: soonTime
			});

			const result = tokenNeedsRefresh('acc-1');

			expect(result).toBe(true);
		});

		it('returns false when token is still valid', () => {
			const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
			mockGetById.mockReturnValue({
				id: 'acc-1',
				email: 'test@test.com',
				token_expires_at: futureTime
			});

			const result = tokenNeedsRefresh('acc-1');

			expect(result).toBe(false);
		});
	});

	describe('getValidAccessToken', () => {
		it('returns error when account does not exist', async () => {
			mockGetById.mockReturnValue(null);

			const result = await getValidAccessToken('nonexistent-id');

			expect(result.accessToken).toBeNull();
			expect(result.error).toBe('Account not found');
		});

		it('returns existing token when not expired', async () => {
			const futureTime = Math.floor(Date.now() / 1000) + 3600;
			mockGetById.mockReturnValue({
				id: 'acc-1',
				email: 'test@test.com',
				access_token: 'valid-token-123',
				token_expires_at: futureTime
			});

			const result = await getValidAccessToken('acc-1');

			expect(result.accessToken).toBe('valid-token-123');
			expect(result.error).toBeUndefined();
		});

		it('returns needsReauth when no refresh token available', async () => {
			const pastTime = Math.floor(Date.now() / 1000) - 3600;
			mockGetById.mockReturnValue({
				id: 'acc-1',
				email: 'test@test.com',
				access_token: 'expired-token',
				refresh_token: null,
				token_expires_at: pastTime
			});

			const result = await getValidAccessToken('acc-1');

			expect(result.accessToken).toBeNull();
			expect(result.needsReauth).toBe(true);
			expect(result.error).toBe('No refresh token available');
		});
	});
});
