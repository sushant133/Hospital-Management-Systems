import AppRoutes from './routes/AppRoutes.jsx';

/**
 * The route table lives in routes/AppRoutes.jsx. Anything app-wide that isn't
 * routing — error boundaries, toasts, query clients — wraps it here.
 */
export function App() {
  return <AppRoutes />;
}

export default App;
