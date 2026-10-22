import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The approved SmartHRMS logo, shown unaltered. Its wordmark is dark navy and blue, so it always sits on a white
 * plate: the dark sidebar and sign-in panel would swallow the "Smart" lettering otherwise.
 */
export function BrandLogo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <span className={cn('inline-block rounded-lg bg-white p-3', className)}>
      {/* The file has wide transparent margins; this window shows just the artwork, at its own proportions. */}
      <span className="relative block w-full overflow-hidden" style={{ aspectRatio: '1568 / 332' }}>
        <Image
          src="/logo/smarthrms-logo.png"
          alt="SmartHRMS — People, Process, Performance"
          width={1814}
          height={927}
          priority={priority}
          sizes="(max-width: 640px) 260px, 320px"
          className="absolute max-w-none"
          style={{ width: '115.7%', left: '-9.4%', top: '-87.3%' }}
        />
      </span>
    </span>
  );
}
