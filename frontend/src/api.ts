import axios from 'axios';

// Create configured axios instance
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true, // Send httpOnly cookies (refresh token)
});

let accessToken: string | null = null;
let onTokenRefreshed: ((token: string) => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

// Request interceptor to attach bearer token
api.interceptors.request.use(
  (config) => {
    if (accessToken && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token expiry (401)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Check if error is 401 (Unauthorized) and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      // If the error code is VAULT_LOCKED, it means the backend key is gone, so do not attempt refresh
      if (error.response.data?.code === 'VAULT_LOCKED') {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        // Attempt token refresh
        const apiBaseUrl = import.meta.env.VITE_API_URL || '/api';
        const refreshResponse = await axios.post(`${apiBaseUrl}/auth/refresh`, {}, { withCredentials: true });
        const newToken = refreshResponse.data.accessToken;
        
        setAccessToken(newToken);
        
        // Notify listener (like App.tsx to update storage/memory state if needed)
        if (onTokenRefreshed) {
          onTokenRefreshed(newToken);
        }

        // Retry the original request with new token
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshErr) {
        // Refresh token is expired or invalid, user must log in again
        setAccessToken(null);
        return Promise.reject(refreshErr);
      }
    }
    
    return Promise.reject(error);
  }
);

export const subscribeTokenRefresh = (callback: (token: string) => void) => {
  onTokenRefreshed = callback;
};

export default api;
