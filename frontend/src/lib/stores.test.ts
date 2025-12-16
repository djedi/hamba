import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	emails,
	selectedEmailId,
	selectedIndex,
	selectedEmail,
	unreadCount,
	emailBodyCache,
	prefetchAdjacentEmails,
	toasts,
	accounts,
	selectedAccountId,
	selectedAccount,
	view,
	isLoading,
	searchQuery,
	composeMode,
	replyToEmail,
	isCommandPaletteOpen,
	currentFolder,
	snippets,
	snippetActions
} from './stores';

// Mock the api module
vi.mock('./api', () => ({
	api: {
		star: vi.fn().mockResolvedValue({}),
		unstar: vi.fn().mockResolvedValue({}),
		markRead: vi.fn().mockResolvedValue({}),
		markUnread: vi.fn().mockResolvedValue({}),
		archive: vi.fn().mockResolvedValue({}),
		trash: vi.fn().mockResolvedValue({}),
		untrash: vi.fn().mockResolvedValue({}),
		permanentDelete: vi.fn().mockResolvedValue({}),
		getEmail: vi.fn().mockResolvedValue(null),
		markImportant: vi.fn().mockResolvedValue({}),
		markNotImportant: vi.fn().mockResolvedValue({}),
		snooze: vi.fn().mockResolvedValue({}),
		unsnooze: vi.fn().mockResolvedValue({}),
		getSnippets: vi.fn().mockResolvedValue([]),
		createSnippet: vi.fn().mockResolvedValue({ success: true, id: 'new-snippet-id' }),
		updateSnippet: vi.fn().mockResolvedValue({ success: true }),
		deleteSnippet: vi.fn().mockResolvedValue({ success: true })
	}
}));

const mockEmail = (id: string, overrides = {}) => ({
	id,
	account_id: 'acc-1',
	thread_id: 'thread-1',
	message_id: `msg-${id}`,
	subject: `Test Email ${id}`,
	snippet: 'This is a test email',
	from_name: 'Test Sender',
	from_email: 'sender@test.com',
	to_addresses: 'recipient@test.com',
	cc_addresses: '',
	bcc_addresses: '',
	body_text: 'Test body',
	body_html: '<p>Test body</p>',
	labels: 'INBOX',
	is_read: 0,
	is_starred: 0,
	is_archived: 0,
	is_trashed: 0,
	is_important: 0,
	snoozed_until: null,
	remind_at: null,
	received_at: Date.now(),
	summary: null,
	summary_generated_at: null,
	...overrides
});

describe('stores', () => {
	beforeEach(() => {
		// Reset stores to initial state
		emails.set([]);
		selectedEmailId.set(null);
		selectedIndex.set(0);
		emailBodyCache.set(new Map());
		toasts.set([]);
		accounts.set([]);
		selectedAccountId.set(null);
		view.set('inbox');
		isLoading.set(false);
		searchQuery.set('');
		composeMode.set('new');
		replyToEmail.set(null);
		isCommandPaletteOpen.set(false);
		currentFolder.set('inbox');
		snippets.set([]);
	});

	describe('selectedEmail derived store', () => {
		it('returns null when no email is selected', () => {
			emails.set([mockEmail('1'), mockEmail('2')]);
			selectedEmailId.set(null);

			expect(get(selectedEmail)).toBeNull();
		});

		it('returns the selected email when one is selected', () => {
			const testEmails = [mockEmail('1'), mockEmail('2')];
			emails.set(testEmails);
			selectedEmailId.set('2');

			expect(get(selectedEmail)).toEqual(testEmails[1]);
		});

		it('returns null when selected id does not exist', () => {
			emails.set([mockEmail('1'), mockEmail('2')]);
			selectedEmailId.set('nonexistent');

			expect(get(selectedEmail)).toBeNull();
		});
	});

	describe('unreadCount derived store', () => {
		it('returns 0 for empty email list', () => {
			emails.set([]);
			expect(get(unreadCount)).toBe(0);
		});

		it('counts unread emails correctly', () => {
			emails.set([
				mockEmail('1', { is_read: 0 }),
				mockEmail('2', { is_read: 1 }),
				mockEmail('3', { is_read: 0 }),
				mockEmail('4', { is_read: 1 })
			]);

			expect(get(unreadCount)).toBe(2);
		});

		it('returns 0 when all emails are read', () => {
			emails.set([
				mockEmail('1', { is_read: 1 }),
				mockEmail('2', { is_read: 1 })
			]);

			expect(get(unreadCount)).toBe(0);
		});
	});

	describe('selectedAccount derived store', () => {
		it('returns null when no account is selected', () => {
			accounts.set([
				{ id: 'acc-1', email: 'test@test.com', name: 'Test', provider_type: 'gmail', created_at: Date.now() }
			]);
			selectedAccountId.set(null);

			expect(get(selectedAccount)).toBeNull();
		});

		it('returns the selected account', () => {
			const testAccounts = [
				{ id: 'acc-1', email: 'test1@test.com', name: 'Test 1', provider_type: 'gmail' as const, created_at: Date.now() },
				{ id: 'acc-2', email: 'test2@test.com', name: 'Test 2', provider_type: 'imap' as const, created_at: Date.now() }
			];
			accounts.set(testAccounts);
			selectedAccountId.set('acc-2');

			expect(get(selectedAccount)).toEqual(testAccounts[1]);
		});
	});

	describe('view store', () => {
		it('defaults to inbox', () => {
			expect(get(view)).toBe('inbox');
		});

		it('can be set to email', () => {
			view.set('email');
			expect(get(view)).toBe('email');
		});

		it('can be set to compose', () => {
			view.set('compose');
			expect(get(view)).toBe('compose');
		});
	});

	describe('emailBodyCache', () => {
		it('starts empty', () => {
			expect(get(emailBodyCache).size).toBe(0);
		});

		it('can cache email bodies', () => {
			emailBodyCache.update((cache) => {
				cache.set('email-1', { text: 'Hello', html: '<p>Hello</p>' });
				return cache;
			});

			const cache = get(emailBodyCache);
			expect(cache.has('email-1')).toBe(true);
			expect(cache.get('email-1')).toEqual({ text: 'Hello', html: '<p>Hello</p>' });
		});
	});

	describe('prefetchAdjacentEmails', () => {
		it('does not throw with valid index', () => {
			emails.set([mockEmail('1'), mockEmail('2'), mockEmail('3')]);

			expect(() => prefetchAdjacentEmails(1)).not.toThrow();
		});

		it('handles edge cases at start of list', () => {
			emails.set([mockEmail('1'), mockEmail('2'), mockEmail('3')]);

			expect(() => prefetchAdjacentEmails(0)).not.toThrow();
		});

		it('handles edge cases at end of list', () => {
			emails.set([mockEmail('1'), mockEmail('2'), mockEmail('3')]);

			expect(() => prefetchAdjacentEmails(2)).not.toThrow();
		});
	});

	describe('currentFolder store', () => {
		it('defaults to inbox', () => {
			expect(get(currentFolder)).toBe('inbox');
		});

		it('can be set to starred', () => {
			currentFolder.set('starred');
			expect(get(currentFolder)).toBe('starred');
		});

		it('can be set to sent', () => {
			currentFolder.set('sent');
			expect(get(currentFolder)).toBe('sent');
		});

		it('can be set to trash', () => {
			currentFolder.set('trash');
			expect(get(currentFolder)).toBe('trash');
		});

		it('can switch between inbox, starred, sent, and trash', () => {
			currentFolder.set('starred');
			expect(get(currentFolder)).toBe('starred');

			currentFolder.set('sent');
			expect(get(currentFolder)).toBe('sent');

			currentFolder.set('trash');
			expect(get(currentFolder)).toBe('trash');

			currentFolder.set('inbox');
			expect(get(currentFolder)).toBe('inbox');
		});
	});

	describe('snippets store', () => {
		const mockSnippet = (id: string, shortcut: string, overrides = {}) => ({
			id,
			account_id: 'acc-1',
			name: `Snippet ${id}`,
			shortcut,
			content: `Content for ${shortcut}`,
			created_at: Math.floor(Date.now() / 1000),
			updated_at: Math.floor(Date.now() / 1000),
			...overrides
		});

		it('starts empty', () => {
			expect(get(snippets)).toEqual([]);
		});

		it('can store snippets', () => {
			const testSnippets = [mockSnippet('1', 'hi'), mockSnippet('2', 'thanks')];
			snippets.set(testSnippets);

			expect(get(snippets)).toEqual(testSnippets);
		});

		describe('snippetActions.getByShortcut', () => {
			it('finds a snippet by shortcut', () => {
				const testSnippets = [
					mockSnippet('1', 'hi'),
					mockSnippet('2', 'thanks'),
					mockSnippet('3', 'followup')
				];
				snippets.set(testSnippets);

				const found = snippetActions.getByShortcut('thanks');
				expect(found).toBeDefined();
				expect(found?.shortcut).toBe('thanks');
			});

			it('returns undefined for non-existent shortcut', () => {
				const testSnippets = [mockSnippet('1', 'hi')];
				snippets.set(testSnippets);

				const found = snippetActions.getByShortcut('nonexistent');
				expect(found).toBeUndefined();
			});
		});
	});
});
