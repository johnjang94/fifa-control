export const metadata = {
  title: "FIFA Control",
  description: "Backend for invite requests.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
