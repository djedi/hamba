import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import AccountSwitcher from './AccountSwitcher.svelte';
import {
	accounts,
	selectedAccountId,
	isAccountSwitcherOpen,
	unreadCounts
} from '../stores';

const makeAccount = (id: string, email: string, extra: Record<string, unknown> = {}) =>
	({
		id,
		email,
		name: email.split('@')[0],
		provider_type: 'imap',
		created_at: 0,
		...extra
	}) as any;

const inputEl = () => screen.getByPlaceholderText('Switch account...') as HTMLInputElement;

describe('AccountSwitcher', () => {
	beforeEach(() => {
		accounts.set([
			makeAccount('a1', 'one@test.com'),
			makeAccount('a2', 'two@test.com', { display_name: 'Work' }),
			makeAccount('a3', 'three@test.com')
		]);
		selectedAccountId.set('a1');
		unreadCounts.set({ a2: 4 });
		isAccountSwitcherOpen.set(true);
	});

	it('lists every account, marks the current one and shows unread counts', () => {
		render(AccountSwitcher);

		expect(screen.getByText('Work')).toBeTruthy();
		expect(screen.getByText('two@test.com')).toBeTruthy();
		expect(screen.getByText('three@test.com')).toBeTruthy();
		expect(screen.getByText('current')).toBeTruthy();
		expect(screen.getByText('4')).toBeTruthy();
	});

	it('starts on the first non-current account so Enter switches away', async () => {
		render(AccountSwitcher);

		await fireEvent.keyDown(inputEl(), { key: 'Enter' });

		expect(get(selectedAccountId)).toBe('a2');
		expect(get(isAccountSwitcherOpen)).toBe(false);
	});

	it('moves the highlight with arrow keys before Enter', async () => {
		render(AccountSwitcher);

		await fireEvent.keyDown(inputEl(), { key: 'ArrowDown' });
		await fireEvent.keyDown(inputEl(), { key: 'Enter' });

		expect(get(selectedAccountId)).toBe('a3');
	});

	it('uses j and k for movement while the query is empty', async () => {
		render(AccountSwitcher);

		await fireEvent.keyDown(inputEl(), { key: 'j' });
		await fireEvent.keyDown(inputEl(), { key: 'Enter' });
		expect(get(selectedAccountId)).toBe('a3');
	});

	it('filters by email or display name', async () => {
		render(AccountSwitcher);

		await fireEvent.input(inputEl(), { target: { value: 'three' } });
		await fireEvent.keyDown(inputEl(), { key: 'Enter' });

		expect(get(selectedAccountId)).toBe('a3');
	});

	it('shows an empty state when nothing matches', async () => {
		render(AccountSwitcher);

		await fireEvent.input(inputEl(), { target: { value: 'nobody' } });

		expect(screen.getByText('No accounts match "nobody"')).toBeTruthy();
	});

	it('jumps straight to an account with a digit when the query is empty', async () => {
		render(AccountSwitcher);

		await fireEvent.keyDown(inputEl(), { key: '3' });

		expect(get(selectedAccountId)).toBe('a3');
		expect(get(isAccountSwitcherOpen)).toBe(false);
	});

	it('ignores digits while filtering', async () => {
		render(AccountSwitcher);

		await fireEvent.input(inputEl(), { target: { value: 'two' } });
		await fireEvent.keyDown(inputEl(), { key: '3' });

		expect(get(selectedAccountId)).toBe('a1');
		expect(get(isAccountSwitcherOpen)).toBe(true);
	});

	it('closes on Escape without switching', async () => {
		render(AccountSwitcher);

		await fireEvent.keyDown(inputEl(), { key: 'Escape' });

		expect(get(isAccountSwitcherOpen)).toBe(false);
		expect(get(selectedAccountId)).toBe('a1');
	});

	it('stops handled keys from reaching the global shortcut handler', async () => {
		const globalKeydown = vi.fn();
		window.addEventListener('keydown', globalKeydown);
		try {
			render(AccountSwitcher);

			await fireEvent.keyDown(inputEl(), { key: 'ArrowDown' });
			expect(globalKeydown).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener('keydown', globalKeydown);
		}
	});
});
