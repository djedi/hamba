import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { api } from './api';
import {
	accountActions,
	adjustUnread,
	labelActions,
	labels,
	emailActions,
	bulkEmailActions,
	unreadCounts,
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
		deleteSnippet: vi.fn().mockResolvedValue({ success: true }),
		getUnreadCounts: vi.fn().mockResolvedValue({}),
		getLabels: vi.fn().mockResolvedValue([]),
		createLabel: vi.fn().mockResolvedValue({ success: true, id: 'new-label' }),
		unarchive: vi.fn().mockResolvedValue({}),
		batchArchive: vi.fn().mockResolvedValue({ success: true, count: 0, failed: [], errors: [] })
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
	ai_importance_score: null,
	ai_classified_at: null,
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

describe('unread counts and account switching', () => {
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	beforeEach(() => {
		emails.set([]);
		accounts.set([
			{ id: 'acc-1', email: 'one@test.com' } as any,
			{ id: 'acc-2', email: 'two@test.com' } as any,
			{ id: 'acc-3', email: 'three@test.com' } as any
		]);
		selectedAccountId.set('acc-1');
		unreadCounts.set({ 'acc-1': 3, 'acc-2': 1 });
		vi.mocked(api.getUnreadCounts).mockReset();
	});

	describe('adjustUnread', () => {
		it('applies deltas and clamps at zero', () => {
			adjustUnread('acc-1', -1);
			expect(get(unreadCounts)['acc-1']).toBe(2);
			adjustUnread('acc-2', -5);
			expect(get(unreadCounts)['acc-2']).toBe(0);
		});

		it('ignores accounts without a known count', () => {
			adjustUnread('unknown', 1);
			expect(get(unreadCounts)).toEqual({ 'acc-1': 3, 'acc-2': 1 });
		});
	});

	describe('accountActions', () => {
		it('switchTo selects a known account', () => {
			accountActions.switchTo('acc-2');
			expect(get(selectedAccountId)).toBe('acc-2');
		});

		it('switchTo ignores unknown accounts', () => {
			accountActions.switchTo('nope');
			expect(get(selectedAccountId)).toBe('acc-1');
		});

		it('switchByIndex is 0-based and ignores out-of-range indexes', () => {
			accountActions.switchByIndex(2);
			expect(get(selectedAccountId)).toBe('acc-3');
			accountActions.switchByIndex(9);
			expect(get(selectedAccountId)).toBe('acc-3');
		});

		it('switchNext and switchPrev wrap around', () => {
			accountActions.switchPrev();
			expect(get(selectedAccountId)).toBe('acc-3');
			accountActions.switchNext();
			expect(get(selectedAccountId)).toBe('acc-1');
			accountActions.switchNext();
			expect(get(selectedAccountId)).toBe('acc-2');
		});

		it('refreshUnreadCounts stores the server counts', async () => {
			vi.mocked(api.getUnreadCounts).mockResolvedValueOnce({ 'acc-1': 7 });
			await accountActions.refreshUnreadCounts();
			expect(get(unreadCounts)).toEqual({ 'acc-1': 7 });
		});

		it('refreshUnreadCounts keeps the last counts on error', async () => {
			vi.mocked(api.getUnreadCounts).mockRejectedValueOnce(new Error('offline'));
			await expect(accountActions.refreshUnreadCounts()).resolves.toBeUndefined();
			expect(get(unreadCounts)).toEqual({ 'acc-1': 3, 'acc-2': 1 });
		});
	});

	describe('optimistic unread deltas', () => {
		const unread = (id: string, overrides = {}) => ({
			id,
			account_id: 'acc-1',
			is_read: 0,
			is_archived: 0,
			is_trashed: 0,
			snoozed_until: null,
			...overrides
		}) as any;

		it('markRead decrements an unread inbox email', () => {
			emails.set([unread('e1')]);
			emailActions.markRead('e1');
			expect(get(unreadCounts)['acc-1']).toBe(2);
		});

		it('markRead on an archived email does not change the inbox count', () => {
			emails.set([unread('e1', { is_archived: 1 })]);
			emailActions.markRead('e1');
			expect(get(unreadCounts)['acc-1']).toBe(3);
		});

		it('markUnread increments a read inbox email', () => {
			emails.set([unread('e1', { is_read: 1 })]);
			emailActions.markUnread('e1');
			expect(get(unreadCounts)['acc-1']).toBe(4);
		});

		it('archive decrements and rolls back on failure', async () => {
			emails.set([unread('e1')]);
			vi.mocked(api.archive).mockRejectedValueOnce(new Error('fail'));
			emailActions.archive('e1');
			expect(get(unreadCounts)['acc-1']).toBe(2);
			await flush();
			expect(get(unreadCounts)['acc-1']).toBe(3);
		});

		it('trash decrements an unread inbox email', () => {
			emails.set([unread('e1')]);
			emailActions.trash('e1');
			expect(get(unreadCounts)['acc-1']).toBe(2);
		});

		it('snooze decrements an unread inbox email', () => {
			emails.set([unread('e1')]);
			emailActions.snooze('e1', 9999999999);
			expect(get(unreadCounts)['acc-1']).toBe(2);
		});

		it('unarchive increments an unread email', () => {
			emails.set([unread('e1', { is_archived: 1 })]);
			emailActions.unarchive('e1');
			expect(get(unreadCounts)['acc-1']).toBe(4);
		});

		it('bulk archive counts only the unread affected emails', () => {
			emails.set([unread('e1'), unread('e2', { is_read: 1 }), unread('e3')]);
			bulkEmailActions.archive(['e1', 'e2', 'e3']);
			expect(get(unreadCounts)['acc-1']).toBe(1);
		});
	});
});

describe('per-account labels', () => {
	const label = (id: string, accountId: string) =>
		({ id, account_id: accountId, name: `label-${id}`, color: '#000', type: 'user', remote_id: null, created_at: 0 }) as any;

	beforeEach(() => {
		accounts.set([{ id: 'acc-1' } as any, { id: 'acc-2' } as any]);
		selectedAccountId.set('acc-1');
		labels.set([]);
		vi.mocked(api.getLabels).mockReset();
	});

	it('shows the cached labels synchronously when switching back to an account', async () => {
		vi.mocked(api.getLabels).mockResolvedValueOnce([label('a', 'acc-1')]);
		await labelActions.loadLabels('acc-1');
		expect(get(labels).map((l) => l.id)).toEqual(['a']);

		selectedAccountId.set('acc-2');
		vi.mocked(api.getLabels).mockResolvedValueOnce([label('b', 'acc-2')]);
		await labelActions.loadLabels('acc-2');
		expect(get(labels).map((l) => l.id)).toEqual(['b']);

		selectedAccountId.set('acc-1');
		vi.mocked(api.getLabels).mockReturnValueOnce(new Promise(() => {}));
		const pending = labelActions.loadLabels('acc-1');
		// Cached labels are visible before the network responds
		expect(get(labels).map((l) => l.id)).toEqual(['a']);
		void pending;
	});

	it('clears another account\'s labels when the account has no cache yet', () => {
		// acc-uncached is never loaded elsewhere in this file, so it has no cache entry
		labels.set([label('a', 'acc-1')]);
		selectedAccountId.set('acc-uncached');
		vi.mocked(api.getLabels).mockReturnValueOnce(new Promise(() => {}));
		void labelActions.loadLabels('acc-uncached');
		expect(get(labels)).toEqual([]);
	});

	it('ignores a response for an account that is no longer selected', async () => {
		let resolveLabels: (value: any) => void = () => {};
		vi.mocked(api.getLabels).mockReturnValueOnce(new Promise((r) => (resolveLabels = r)));
		selectedAccountId.set('acc-2');
		const pending = labelActions.loadLabels('acc-2');

		selectedAccountId.set('acc-1');
		labels.set([label('a', 'acc-1')]);
		resolveLabels([label('b', 'acc-2')]);
		await pending;

		expect(get(labels).map((l) => l.id)).toEqual(['a']);
	});

	it('keeps the cache in sync when a label is created', async () => {
		vi.mocked(api.getLabels).mockResolvedValueOnce([label('a', 'acc-1')]);
		await labelActions.loadLabels('acc-1');

		await labelActions.createLabel('acc-1', 'New');

		selectedAccountId.set('acc-2');
		vi.mocked(api.getLabels).mockResolvedValueOnce([]);
		await labelActions.loadLabels('acc-2');

		selectedAccountId.set('acc-1');
		vi.mocked(api.getLabels).mockReturnValueOnce(new Promise(() => {}));
		void labelActions.loadLabels('acc-1');
		expect(get(labels).map((l) => l.name)).toEqual(['label-a', 'New']);
	});
});
