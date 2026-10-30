import './PaletteSwatches.css';

export function PaletteSwatches({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <view className={`palette-swatches palette-swatches--${size}`}>
      <view className="palette-swatches__dot palette-swatches__dot--primary" />
      <view className="palette-swatches__dot palette-swatches__dot--secondary" />
    </view>
  );
}
