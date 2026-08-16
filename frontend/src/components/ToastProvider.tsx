import { Toaster } from "sonner";

export default function ToastProvider() {
  return (
    <Toaster
      position="bottom-center"
      expand={false}
      closeButton={false}
      gap={8}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        unstyled: true,
        className: "flex justify-center w-[calc(100vw-2rem)] sm:w-auto",
      }}
    />
  );
}
