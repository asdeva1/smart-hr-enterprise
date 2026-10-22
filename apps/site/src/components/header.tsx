import Link from 'next/link';
import { Logo } from './logo';
import { SignInMenu } from './signin-menu';
import { ButtonLink } from './ui';

const links = [
  { href: '/features', label: 'Features' },
  { href: '/plans', label: 'Plans' },
  { href: '/security', label: 'Security' },
  { href: '/contact', label: 'Contact' },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        <Link href="/" aria-label="SmartHRMS home" className="shrink-0">
          <Logo width={168} />
        </Link>
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-[15px] font-medium text-ink-soft hover:bg-brand-soft hover:text-brand-deep"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <SignInMenu />
          <span className="hidden sm:block">
            <ButtonLink href="/demo" className="!py-2">
              Try the demo
            </ButtonLink>
          </span>
        </div>
      </div>
      {/* On phones the links sit in a second row rather than behind a menu button. */}
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1 md:hidden">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-[15px] font-medium">
            {l.label}
          </Link>
        ))}
        <Link href="/demo" className="rounded-md px-3 py-2 text-[15px] font-semibold text-brand">
          Demo
        </Link>
      </nav>
    </header>
  );
}
