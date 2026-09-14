import { useEffect, useState } from 'react';
import { checkSupabaseConnection } from '../lib/supabase';

export default function SupabaseStatus() {
  const [status, setStatus] = useState({
    loading: true,
    connected: false,
    message: 'Checking connection...',
  });

  useEffect(() => {
    let active = true;

    async function checkConnection() {
      const result = await checkSupabaseConnection();

      if (!active) return;

      setStatus({
        loading: false,
        connected: result.connected,
        message: result.message,
      });
    }

    checkConnection();

    return () => {
      active = false;
    };
  }, []);

  if (status.loading) {
    return (
      <div className="sync-status">
        🟡 Checking Supabase...
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="sync-status sync-connected">
        🟢 Connected to Supabase
      </div>
    );
  }

  return (
    <div
      className="sync-status sync-error"
      title={status.message}
    >
      🔴 Supabase connection failed
    </div>
  );
}