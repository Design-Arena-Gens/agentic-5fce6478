import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'অফলাইন মেসেঞ্জার',
  description: 'অফলাইন মেসেজিং এবং অনলাইন ভিডিও/অডিও কল',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="bn">
      <body>{children}</body>
    </html>
  )
}
