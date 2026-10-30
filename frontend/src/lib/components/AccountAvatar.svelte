<script lang="ts">
  import { api, type Account } from "$lib/api";
  import {
    DEFAULT_ACCOUNT_COLOR,
    checkGravatar,
    getCachedGravatar,
    getInitials,
    gravatarHash,
    gravatarUrl,
    pickAvatarSource,
  } from "$lib/accountAppearance";

  let { account, size = 28 }: { account: Account; size?: number } = $props();

  const initials = $derived(getInitials(account));
  const color = $derived(account.color || DEFAULT_ACCOUNT_COLOR);

  // Image URL shown over the initials once it has loaded successfully
  let gravatarSrc = $state<string | null>(null);
  let loadedSrc = $state<string | null>(null);

  const source = $derived(pickAvatarSource(account, getCachedGravatar(account.email)));
  const uploadSrc = $derived(
    account.has_avatar ? api.accountAvatarUrl(account.id, account.avatar_updated_at) : null
  );

  $effect(() => {
    const email = account.email;
    const px = size;
    gravatarSrc = null;
    if (account.has_avatar) return;
    let cancelled = false;
    checkGravatar(email, px).then(async (res) => {
      if (cancelled || res !== "ok") return;
      gravatarSrc = gravatarUrl(await gravatarHash(email), px);
    });
    return () => {
      cancelled = true;
    };
  });

  const imgSrc = $derived(source === "upload" ? uploadSrc : gravatarSrc);
</script>

<span
  class="account-avatar"
  style="width:{size}px;height:{size}px;background:{color};font-size:{Math.round(size * 0.42)}px"
  aria-hidden="true"
>
  {initials}
  {#if imgSrc}
    <img
      src={imgSrc}
      alt=""
      class:loaded={loadedSrc === imgSrc}
      onload={() => (loadedSrc = imgSrc)}
      onerror={() => (loadedSrc = null)}
    />
  {/if}
</span>

<style>
  .account-avatar {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 50%;
    color: white;
    font-weight: 600;
    line-height: 1;
    overflow: hidden;
    user-select: none;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
  }

  img.loaded {
    opacity: 1;
  }
</style>
