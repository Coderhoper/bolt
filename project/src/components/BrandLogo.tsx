type BrandLogoProps = {
  size?: 'sm' | 'md' | 'lg';
  inverse?: boolean;
  tagline?: boolean;
  className?: string;
};

const sizes = {
  sm: { mark: 'h-8 w-8', name: 'text-[14px]', tagline: 'text-[7px]' },
  md: { mark: 'h-10 w-10', name: 'text-[17px]', tagline: 'text-[8px]' },
  lg: { mark: 'h-14 w-14', name: 'text-[22px]', tagline: 'text-[9px]' },
};

export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return <img src="/auditguard-mark.svg" alt="" aria-hidden="true" className={`block shrink-0 object-contain ${className}`} />;
}

export function BrandLogo({ size = 'md', inverse = false, tagline = false, className = '' }: BrandLogoProps) {
  const style = sizes[size];
  const wordColor = inverse ? 'text-[#f4dda0]' : 'text-[#332818]';
  const taglineColor = inverse ? 'text-[#cbbd98]' : 'text-[#786849]';

  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <BrandMark className={style.mark} />
      <span className="block min-w-0">
        <span className={`block font-serif font-bold leading-none tracking-[.045em] ${style.name} ${wordColor}`}>AUDITGUARD</span>
        {tagline && <span className={`mt-1 block font-sans font-semibold uppercase leading-tight tracking-[.095em] ${style.tagline} ${taglineColor}`}>Systems | Enterprise Management<br />Govern | Optimize | Secure</span>}
      </span>
    </span>
  );
}
