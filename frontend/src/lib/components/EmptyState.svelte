<script lang="ts">
  import type { Component } from "svelte";
  interface Props {
    icon: Component<{ size?: number | string }>;
    title: string;
    description: string;
    variant?: "default" | "success";
  }

  let { icon: Icon, title, description, variant = "default" }: Props = $props();
</script>

<div class="empty" class:success={variant === "success"}>
  <span class="empty-icon"><Icon size={variant === "success" ? 56 : 48} /></span>
  <h3>{title}</h3>
  <p>{description}</p>
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-secondary);
    padding: 24px;
    text-align: center;
  }

  .empty-icon {
    display: inline-flex;
    color: var(--text-muted);
  }

  .empty h3 {
    color: var(--text-primary);
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .empty.success h3 {
    font-size: 18px;
  }

  .empty p {
    color: var(--text-muted);
    margin: 0;
    font-size: 14px;
    max-width: 280px;
    line-height: 1.4;
  }
</style>
