<script lang="ts">
  interface Props {
    icon: string;
    title: string;
    description: string;
    variant?: "default" | "success";
  }

  let { icon, title, description, variant = "default" }: Props = $props();
</script>

<div class="empty" class:success={variant === "success"}>
  <span class="empty-icon">{icon}</span>
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
    font-size: 48px;
  }

  .empty.success .empty-icon {
    font-size: 56px;
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
