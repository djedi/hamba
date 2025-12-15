import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock the db module
const mockGetById = mock(() => null);

mock.module('../../db', () => ({
	accountQueries: {
		getById: {
			get: mockGetById
		}
	}
}));

// Mock the providers to avoid their internal dependencies
mock.module('./gmail', () => ({
	GmailProvider: class MockGmailProvider {
		accountId: string;
		constructor(accountId: string) {
			this.accountId = accountId;
		}
	}
}));

mock.module('./imap-smtp', () => ({
	ImapSmtpProvider: class MockImapSmtpProvider {
		accountId: string;
		constructor(accountId: string) {
			this.accountId = accountId;
		}
	}
}));

// Import after mocking
import { getProvider } from './index';

describe('getProvider', () => {
	beforeEach(() => {
		mockGetById.mockReset();
	});

	it('throws error when account does not exist', () => {
		mockGetById.mockReturnValue(null);

		expect(() => getProvider('nonexistent-id')).toThrow('Account not found');
	});

	it('returns GmailProvider for gmail accounts', () => {
		mockGetById.mockReturnValue({
			id: 'acc-1',
			email: 'test@gmail.com',
			provider_type: 'gmail'
		});

		const provider = getProvider('acc-1');

		expect(provider).toBeDefined();
		expect((provider as any).accountId).toBe('acc-1');
	});

	it('returns ImapSmtpProvider for imap accounts', () => {
		mockGetById.mockReturnValue({
			id: 'acc-2',
			email: 'test@custom.com',
			provider_type: 'imap'
		});

		const provider = getProvider('acc-2');

		expect(provider).toBeDefined();
		expect((provider as any).accountId).toBe('acc-2');
	});

	it('defaults to GmailProvider when provider_type is undefined', () => {
		mockGetById.mockReturnValue({
			id: 'acc-3',
			email: 'test@test.com',
			provider_type: undefined
		});

		const provider = getProvider('acc-3');

		expect(provider).toBeDefined();
	});
});
