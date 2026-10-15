import { useEffect, useState } from 'react';
import api from '../../../shared/api/axiosInstance';

/**
 * Admin-managed legal documents.
 *
 * Served by its own endpoint rather than with the landing content, because the
 * documents are large and the landing payload is fetched on every visit to the
 * marketing site.
 *
 * Anything the admin has not filled in stays empty, and LegalPage falls back to
 * the copy bundled with the app — so the pages never render blank, and there is
 * only one place the fallback text lives.
 */
export default function useLegalContent() {
  const [legal, setLegal] = useState(null);

  useEffect(() => {
    let alive = true;

    api
      .get('/users/legal-content')
      .then((response) => {
        if (!alive) return;
        const data = response?.data?.data ?? response?.data;
        if (data && typeof data === 'object') setLegal(data);
      })
      .catch(() => {
        /* keep the bundled copy */
      });

    return () => {
      alive = false;
    };
  }, []);

  return legal || {};
}
