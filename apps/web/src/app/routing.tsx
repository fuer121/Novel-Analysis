import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

interface LocationValue {
  pathname: string;
  search: string;
}

interface NavigateOptions {
  replace?: boolean;
}

interface NavigationValue {
  location: LocationValue;
  navigate: (to: string, options: NavigateOptions | undefined, basePath: string) => void;
}

interface RouteValue {
  basePath: string;
  params: Record<string, string | undefined>;
}

interface OutletSlotValue {
  element: ReactNode;
}

type SearchParamsInit = string | URLSearchParams | Record<string, string>;
type SearchParamsSetter = (next: SearchParamsInit, options?: NavigateOptions) => void;

const NavigationContext = createContext<NavigationValue | null>(null);
const RouteContext = createContext<RouteValue>({ basePath: "/", params: {} });
const OutletSlotContext = createContext<OutletSlotValue>({ element: null });
const OutletValueContext = createContext<unknown>(undefined);
const internalOrigin = "http://internal-router";

function parseLocation(value: string): LocationValue {
  const url = new URL(value, internalOrigin);
  return { pathname: url.pathname, search: url.search };
}

function comparablePath(pathname: string): string {
  try {
    return pathname.split("/").map((segment) => decodeURIComponent(segment).toLowerCase()).join("/");
  } catch {
    return pathname.toLowerCase();
  }
}

function browserLocation(): LocationValue {
  return { pathname: window.location.pathname, search: window.location.search };
}

function resolveHref(to: string, basePath: string): string {
  const target = to.trimStart();
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) {
    throw new Error("internal_navigation_required");
  }
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const url = new URL(to, `${internalOrigin}${base}`);
  if (url.protocol !== "http:" || url.origin !== internalOrigin) {
    throw new Error("internal_navigation_required");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("router_context_required");
  return value;
}

export function RouterRoot({ initialEntries, children }: { initialEntries?: string[]; children: ReactNode }) {
  const memory = initialEntries !== undefined;
  const [location, setLocation] = useState<LocationValue>(() => (
    memory ? parseLocation(initialEntries.at(-1) ?? "/") : browserLocation()
  ));

  useEffect(() => {
    if (memory) return undefined;
    const onPopState = () => setLocation(browserLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [memory]);

  const navigate = useCallback<NavigationValue["navigate"]>((to, options, basePath) => {
    const href = resolveHref(to, basePath);
    if (!memory) {
      window.history[options?.replace ? "replaceState" : "pushState"](null, "", href);
    }
    setLocation(parseLocation(href));
  }, [memory]);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function MemoryRouter({ initialEntries = ["/"], children }: { initialEntries?: string[]; children: ReactNode }) {
  return <RouterRoot initialEntries={initialEntries}>{children}</RouterRoot>;
}

export function RouteScope({
  basePath,
  params = {},
  children,
}: {
  basePath: string;
  params?: Record<string, string | undefined>;
  children: ReactNode;
}) {
  const parent = useContext(RouteContext);
  const value = useMemo(() => ({
    basePath,
    params: { ...parent.params, ...params },
  }), [basePath, params, parent.params]);
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

export function OutletSlot({ element, children }: { element: ReactNode; children: ReactNode }) {
  const value = useMemo(() => ({ element }), [element]);
  return <OutletSlotContext.Provider value={value}>{children}</OutletSlotContext.Provider>;
}

export function Outlet({ context }: { context?: unknown }) {
  const { element } = useContext(OutletSlotContext);
  return <OutletValueContext.Provider value={context}>{element}</OutletValueContext.Provider>;
}

export function useOutletContext<T>(): T {
  return useContext(OutletValueContext) as T;
}

export function useLocation(): LocationValue {
  return useNavigation().location;
}

export function useNavigate() {
  const router = useNavigation();
  const { basePath } = useContext(RouteContext);
  return useCallback((to: string, options?: NavigateOptions) => {
    router.navigate(to, options, basePath);
  }, [basePath, router]);
}

export function useParams(): Record<string, string | undefined> {
  return useContext(RouteContext).params;
}

export function useSearchParams(): [URLSearchParams, SearchParamsSetter] {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const setParams = useCallback<SearchParamsSetter>((next, options) => {
    const serialized = new URLSearchParams(next).toString();
    navigate(serialized ? `${pathname}?${serialized}` : pathname, options);
  }, [navigate, pathname]);
  return [params, setParams];
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  replace?: boolean;
}

export function Link({ to, replace, onClick, target, ...props }: LinkProps) {
  const navigate = useNavigate();
  const { basePath } = useContext(RouteContext);
  const href = resolveHref(to, basePath);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.altKey
      || event.ctrlKey
      || event.shiftKey
      || (target && target !== "_self")
    ) return;
    event.preventDefault();
    navigate(to, { replace });
  };
  return <a {...props} href={href} target={target} onClick={follow} />;
}

export function NavLink({ className, ...props }: LinkProps) {
  const { pathname } = useLocation();
  const { basePath } = useContext(RouteContext);
  const href = resolveHref(props.to, basePath);
  const targetPath = parseLocation(href).pathname;
  const currentComparable = comparablePath(pathname);
  const targetComparable = comparablePath(targetPath);
  const active = currentComparable === targetComparable || currentComparable.startsWith(`${targetComparable}/`);
  const classes = [className, active ? "active" : null].filter(Boolean).join(" ");
  return <Link {...props} className={classes || undefined} aria-current={active ? "page" : undefined} />;
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}
