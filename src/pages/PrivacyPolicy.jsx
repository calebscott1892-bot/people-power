import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-black mb-4">Privacy Policy</h1>
      <p className="mb-4">We take your privacy seriously. This policy explains what data we collect, why, and your rights.</p>
      <h2 className="text-xl font-bold mt-6 mb-2">What We Collect</h2>
      <ul className="list-disc pl-6 mb-4">
        <li><b>Account Data:</b> Email, profile info, authentication details.</li>
        <li><b>Content:</b> Movements, messages, uploads, comments, resources, evidence.</li>
        <li><b>Device/Usage Data:</b> Basic device/browser info, usage analytics (non-identifiable).</li>
        <li><b>Location:</b> City/region only, never exact GPS (see below).</li>
      </ul>
      <h2 className="text-xl font-bold mt-6 mb-2">Why We Collect It</h2>
      <ul className="list-disc pl-6 mb-4">
        <li>To run and improve the service</li>
        <li>For safety, moderation, and anti-abuse</li>
        <li>To enable discovery of local movements (using only city/region)</li>
        <li>For basic analytics (never sold or shared for ads)</li>
      </ul>
      <h2 className="text-xl font-bold mt-6 mb-2">How Long We Keep Data</h2>
      <p className="mb-4">We keep your data only as long as needed to provide the service and meet legal/safety requirements. You can request deletion at any time.</p>
      <h2 className="text-xl font-bold mt-6 mb-2">Your Rights</h2>
      <ul className="list-disc pl-6 mb-4">
        <li>Contact us to delete your account or data: <a href="mailto:support@example.com" className="text-blue-600 underline">support@example.com</a></li>
        <li>You can export your data via the app or by request</li>
      </ul>
      <h2 className="text-xl font-bold mt-6 mb-2">Location Data Minimization</h2>
      <p className="mb-4">We store only city/region for user profiles and movement discovery. Exact GPS is never stored in your public profile or shared. Precise location is used only on-device for local filtering.</p>
      <h2 className="text-xl font-bold mt-6 mb-2">Contact</h2>
      <p>For any privacy questions or requests, email <a href="mailto:support@example.com" className="text-blue-600 underline">support@example.com</a>.</p>
    </div>
  );
}
