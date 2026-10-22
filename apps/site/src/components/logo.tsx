import Image from 'next/image';

/** The approved logo, unaltered, cropped to its artwork. It sits on white; the header is white. */
export function Logo({ width = 200 }: { width?: number }) {
  return (
    <span
      className="relative block overflow-hidden"
      style={{ width, aspectRatio: '1568 / 332' }}
      role="img"
      aria-label="SmartHRMS, People, Process, Performance"
    >
      <Image
        src="/logo/smarthrms-logo.png"
        alt=""
        width={1814}
        height={927}
        priority
        className="absolute max-w-none"
        style={{ width: '115.7%', left: '-9.4%', top: '-87.3%' }}
      />
    </span>
  );
}
