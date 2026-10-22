import type { ComponentProps } from 'react';
import { Link as RouterLink, NavLink as RouterNavLink } from 'react-router-dom';
import { withRuntimeEnvironment } from '../lib/runtime-environment';

/** Keep the explicit staging query through internal SPA links only. */
export function Link({ to, ...props }: ComponentProps<typeof RouterLink>) {
  return <RouterLink {...props} to={withRuntimeEnvironment(to)} />;
}

export function NavLink({ to, ...props }: ComponentProps<typeof RouterNavLink>) {
  return <RouterNavLink {...props} to={withRuntimeEnvironment(to)} />;
}
