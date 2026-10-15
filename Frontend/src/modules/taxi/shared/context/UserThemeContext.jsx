import React, { createContext, useContext, useState } from 'react';

const UserThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {},
});

export const UserThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('userAppTheme');
      return saved === 'dark' ? 'dark' : 'light';
    }
    return 'light';
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('userAppTheme', next);
      return next;
    });
  };

  return (
    <UserThemeContext.Provider value={{ theme, toggleTheme }}>
      {/* The `dark` class lives on this wrapper (not <html>/<body>) so Tailwind's dark: variant works
          for taxi screens without touching the page the platform shell owns. */}
      <div className={theme === 'dark' ? 'dark' : undefined} style={{ display: 'contents' }}>
        {children}
      </div>
    </UserThemeContext.Provider>
  );
};

export const useUserTheme = () => useContext(UserThemeContext);
