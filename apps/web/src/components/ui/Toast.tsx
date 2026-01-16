import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-center"
      theme="dark"
      richColors
      toastOptions={{
        classNames: {
          toast: 'bg-surface border border-app',
          title: 'text-heading',
          description: 'text-muted',
        },
      }}
    />
  );
}
