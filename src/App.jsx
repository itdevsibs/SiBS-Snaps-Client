import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import QRWallDisplayPage from './pages/qr-wall/QRWallDisplayPage';
import QRWallJoinPage from './pages/qr-wall/QRWallJoinPage';
import QRWallModeratorPage from './pages/qr-wall/QRWallModeratorPage';
import apiClient from './lib/axios/api';
import { createQrWallApi } from './lib/axios/qrWallApi';
import './pages/qr-wall/qrWall.css';

const qrApi = createQrWallApi(apiClient);

function Join() {
  const { token } = useParams();
  return <QRWallJoinPage api={qrApi} token={token} />;
}

export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/" element={<Navigate to="/photo-wall/display" replace />} />
    <Route path="/photo-wall/display" element={<QRWallDisplayPage api={qrApi} />} />
    <Route path="/photo-wall/moderator" element={<QRWallModeratorPage api={qrApi} />} />
    <Route path="/photo-wall/join/:token" element={<Join />} />
    <Route path="*" element={<Navigate to="/photo-wall/display" replace />} />
  </Routes></BrowserRouter>;
}
