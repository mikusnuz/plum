import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a className="font-semibold text-green-600 hover:underline" href="/forgot-password">
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative min-h-screen">
      {/* Background: mock chat interface */}
      <div className="absolute inset-0 bg-gray-100 dark:bg-gray-800" aria-hidden="true">
        {/* Simulated sidebar */}
        <div className="absolute left-0 top-0 hidden h-full w-64 border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900 md:block">
          <div className="p-4">
            <div className="mb-6 h-8 w-32 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-6 rounded bg-gray-200 dark:bg-gray-700" style={{ width: `${60 + Math.random() * 40}%` }} />
              ))}
            </div>
          </div>
        </div>
        {/* Simulated chat area */}
        <div className="absolute inset-0 md:left-64">
          <div className="flex h-full flex-col items-center justify-center p-8">
            <div className="mb-4 h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="mb-2 h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-64 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
              ))}
            </div>
          </div>
          {/* Simulated input bar */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="mx-auto h-12 max-w-3xl rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
          </div>
        </div>
      </div>

      {/* Backdrop overlay - non-dismissible */}
      <div
        className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm"
        style={{ pointerEvents: 'auto' }}
        aria-hidden="true"
      />

      {/* Login modal */}
      <div className="relative z-50 flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
          <BlinkAnimation active={isFetching}>
            <div className="mb-6 h-10 w-full">
              <img
                src="assets/logo.png"
                className="h-full w-full object-contain"
                alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'Plum' })}
              />
            </div>
          </BlinkAnimation>
          <DisplayError />
          {!hasStartupConfigError && !isFetching && header && (
            <h1
              className="mb-4 text-center text-2xl font-semibold text-black dark:text-white"
              style={{ userSelect: 'none' }}
            >
              {header}
            </h1>
          )}
          {children}
          {!pathname.includes('2fa') &&
            (pathname.includes('login') || pathname.includes('register')) && (
              <SocialLoginRender startupConfig={startupConfig} />
            )}
          <p className="mt-4 text-center text-xs text-gray-400">
            AI chat powered by Plumise blockchain
          </p>
        </div>
      </div>

      {/* Theme selector */}
      <div className="absolute bottom-0 left-0 z-50 md:m-4">
        <ThemeSelector />
      </div>
    </div>
  );
}

export default AuthLayout;
