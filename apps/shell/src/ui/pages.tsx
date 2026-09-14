import type { PlatformError } from '@platform/sdk'
import { Button } from '@tecton/react/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@tecton/react/components/empty'
import type { DevIdentity } from '../providers/dev-identity'

/** The shell owns these so every app fails the same way. */

export function NotFoundPage({ url, onSwitcher }: { url: URL; onSwitcher: () => void }) {
  return (
    <Page title="Page not found" testId="shell.not-found">
      <EmptyDescription>
        No app owns <code>{url.pathname}</code>.
      </EmptyDescription>
      <EmptyContent>
        <Button onPress={onSwitcher}>Open an app</Button>
      </EmptyContent>
    </Page>
  )
}

export function ForbiddenPage({ appTitle, onSwitcher }: { appTitle: string; onSwitcher: () => void }) {
  return (
    <Page title="No access to this app" testId="shell.forbidden">
      <EmptyDescription>You do not have access to {appTitle}. Ask its owners for access, or open another app.</EmptyDescription>
      <EmptyContent className="flex gap-2">
        <Button variant="outline" onPress={() => window.open('mailto:support@example.com?subject=Access request', '_blank')}>
          Request access
        </Button>
        <Button onPress={onSwitcher}>Open an app</Button>
      </EmptyContent>
    </Page>
  )
}

export function FailedPage({ appTitle, error, onRetry }: { appTitle: string; error: PlatformError | undefined; onRetry: () => void }) {
  return (
    <Page title="Something went wrong" testId="shell.failed">
      <EmptyDescription>
        {appTitle} could not be loaded{error ? `: ${error.message}`: ''}.
      </EmptyDescription>
      <EmptyContent className="flex gap-2">
        <Button onPress={onRetry}>Retry</Button>
        <Button variant="outline" onPress={() => window.open(`mailto:support@example.com?subject=Problem loading ${encodeURIComponent(appTitle)}`, '_blank')}>
          Report a problem
        </Button>
      </EmptyContent>
    </Page>
  )
}

export function SignInPage({ identity, intended }: { identity: DevIdentity; intended: URL }) {
  return (
    <Page title="Sign in again" testId="shell.sign-in">
      <EmptyDescription>
        Your session has ended. Sign in to continue to <code>{intended.pathname}</code>.
      </EmptyDescription>
      <EmptyContent className="flex flex-wrap justify-center gap-2">
        {identity.profiles.map(p => (
          <Button key={p.id} variant={p.id === identity.profiles[0]?.id ? 'default': 'outline'} onPress={() => identity.signIn(p.id)} data-testid={`shell.sign-in.${p.id}`}>
            {p.user.displayName} <span className="text-muted-foreground ml-1 text-xs">({p.groups.length ? p.groups.join(', '): 'no groups'})</span>
          </Button>
        ))}
      </EmptyContent>
    </Page>
  )
}

export function MaintenancePage({ message }: { message: string }) {
  return (
    <Page title="Maintenance" testId="shell.maintenance">
      <EmptyDescription>The platform cannot start: {message}</EmptyDescription>
      <EmptyContent>
        <Button onPress={() => location.reload()}>Reload</Button>
      </EmptyContent>
    </Page>
  )
}

function Page({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid={testId}>
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>
            <h1 tabIndex={-1}>{title}</h1>
          </EmptyTitle>
        </EmptyHeader>
        {children}
      </Empty>
    </div>
  )
}
