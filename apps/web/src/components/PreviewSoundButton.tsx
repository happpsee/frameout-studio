/** Mute / unmute for the sequence preview; drawn like the other preview icon buttons. */
export default function PreviewSoundButton({
  muted,
  onToggle,
}: {
  muted: boolean;
  onToggle: () => void;
}) {
  const label = muted ? '打开声音' : '关闭声音';
  return (
    <button
      type="button"
      className="fo-icon-button fo-preview-sound"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span data-icon={muted ? 'sound-off' : 'sound'} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 9v6h4l5 4V5L8 9H4Z" />
          {muted ? (
            <path d="m16 9 5 6m0-6-5 6" />
          ) : (
            <path d="M16 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" />
          )}
        </svg>
      </span>
    </button>
  );
}
