"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bell,
  ClipboardCheck,
  FlaskConical,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Menu,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Role } from "@/generated/prisma";

export interface ShellUser {
  name: string | null;
  email: string;
  image: string | null;
  role: Role;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole?: Role;
  badge?: number;
}

const ROLE_RANK: Record<Role, number> = {
  [Role.CONTRIBUTOR]: 1,
  [Role.REVIEWER]: 2,
  [Role.ADMIN]: 3,
};

export function AppShell({
  user,
  children,
  unreadCount = 0,
  pendingReviews = 0,
  isDevelopment,
  productionPublishingEnabled,
}: {
  user: ShellUser;
  children: React.ReactNode;
  unreadCount?: number;
  pendingReviews?: number;
  isDevelopment: boolean;
  productionPublishingEnabled: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/content", label: "Content", icon: LibraryBig },
    {
      href: "/review",
      label: "Review",
      icon: ClipboardCheck,
      minRole: Role.REVIEWER,
      badge: pendingReviews,
    },
    { href: "/admin", label: "Settings", icon: Settings, minRole: Role.ADMIN },
  ].filter((item) => !item.minRole || ROLE_RANK[user.role] >= ROLE_RANK[item.minRole]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)) ||
    (href === "/admin" && pathname.startsWith("/admin"));

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Keyboard users should not have to tab through the whole nav. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to main content
      </a>

      {/*
        Environment banner. Section 40 requires development and production to
        be unmistakable — publishing to the wrong channel is unrecoverable.
      */}
      {isDevelopment && (
        <div className="flex items-center justify-center gap-2 bg-warn-600 px-4 py-1.5 text-center text-xs font-medium text-white">
          <FlaskConical className="size-3.5" aria-hidden="true" />
          <span>
            Development mode — publishing to YouTube is{" "}
            {productionPublishingEnabled ? "ENABLED" : "disabled"}
          </span>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-white/70 bg-surface/85 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <BrandMark className="size-7" />
            <span className="hidden text-sm font-semibold text-ink sm:inline">
              Channel Publisher
            </span>
          </Link>

          <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-gradient-to-r from-brand-100 to-info-50 text-brand-700 shadow-sm ring-1 ring-brand-200/70"
                    : "text-ink-soft hover:bg-brand-50/70 hover:text-brand-700",
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
                {item.badge ? (
                  <span className="ml-0.5 rounded-full bg-warn-600 px-1.5 text-[10px] font-semibold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/content/new">
                <Plus className="size-4" aria-hidden="true" />
                Create
              </Link>
            </Button>

            <Link
              href="/notifications"
              className="relative rounded-lg p-2 text-ink-soft hover:bg-surface-muted hover:text-ink"
              aria-label={
                unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"
              }
            >
              <Bell className="size-4.5" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-danger-600 ring-2 ring-surface" />
              )}
            </Link>

            {/* User menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-muted"
              >
                <span className="sr-only">Account menu</span>
                {user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.image}
                    alt=""
                    className="size-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                    {initials(user.name, user.email)}
                  </span>
                )}
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden="true"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-overlay)]"
                  >
                    <div className="border-b border-line px-3.5 py-3">
                      <p className="truncate text-sm font-medium text-ink">
                        {user.name ?? user.email}
                      </p>
                      <p className="truncate text-xs text-ink-soft">{user.email}</p>
                      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                        {user.role.toLowerCase()}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void signOut({ callbackUrl: "/signin" })}
                      className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-ink-soft hover:bg-surface-muted hover:text-ink"
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              className="rounded-lg p-2 text-ink-soft hover:bg-surface-muted md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-label="Main menu"
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav aria-label="Main" className="border-t border-line bg-surface px-3 py-2 md:hidden">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  isActive(item.href)
                    ? "bg-gradient-to-r from-brand-100 to-info-50 text-brand-700 ring-1 ring-brand-200/70"
                    : "text-ink-soft hover:bg-brand-50/70",
                )}
              >
                <item.icon className="size-4.5" aria-hidden="true" />
                {item.label}
                {item.badge ? (
                  <span className="ml-auto rounded-full bg-warn-600 px-1.5 text-[10px] font-semibold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
            <Link
              href="/content/new"
              onClick={() => setMobileOpen(false)}
              className="mt-1 flex items-center gap-3 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-medium text-white"
            >
              <Plus className="size-4.5" aria-hidden="true" />
              Create content
            </Link>
          </nav>
        )}
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      {/*
        YouTube Developer Policy III.A.1 requires a visible link to YouTube's
        Terms of Service, and III.A.2.a requires the privacy policy to be
        accessible at all times — hence in the shell, not on one page.
      */}
      <footer className="mx-auto max-w-7xl px-4 pb-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line pt-6 text-xs text-ink-faint">
          <span>This app uses YouTube API Services.</span>
          <Link href="/privacy" className="hover:text-ink-soft">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-ink-soft">
            Terms of Service
          </Link>
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink-soft"
          >
            YouTube Terms of Service
          </a>
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink-soft"
          >
            Google Privacy Policy
          </a>
          <a
            href="https://security.google.com/settings/security/permissions"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink-soft"
          >
            Manage Google access
          </a>
        </div>
      </footer>
    </div>
  );
}
