import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Home from './pages/Home';
import CameraPage from './pages/CameraPage';
import LicensePlatePage from './pages/LicensePlatePage';
import SoundThreatPage from './pages/SoundThreatPage';
import FaceDatabasePage from './pages/FaceDatabasePage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/"                      element={<Login />} />
        <Route path="/dashboard"             element={<Home />} />
        <Route path="/dashboard/cam1"        element={<CameraPage
                                                         feedUrl="/video_feed"
                                                         title="Face Recognition & Intrusion Detection"
                                                         subtitle="CAM 01 — Main Gate"
                                                         color="#ec4899"
                                                         showReset={true}
                                                         trespassOnly={true}
                                                         enableSiren={false}
                                                         enableTrespassSiren={true}
                                                       />} />
        <Route path="/dashboard/tailgating"  element={<CameraPage
                                                         feedUrl="/video_feed_2"
                                                         title="Tailgating Detection"
                                                         subtitle="CAM 02 — Entry Zone"
                                                         color="#0891b2"
                                                         hideAlerts={true}
                                                         enableSiren={false}
                                                       />} />
        <Route path="/dashboard/face"        element={<CameraPage
                                                         feedUrl="/video_feed_3"
                                                         title="Weapon Detection"
                                                         subtitle="CAM 03 — Weapons"
                                                         color="#dc2626"
                                                         enableSiren={true}
                                                         weaponsOnly={true}
                                                       />} />
        <Route path="/dashboard/crowd"       element={<LicensePlatePage />} />
        <Route path="/dashboard/perimeter"   element={<SoundThreatPage />} />
        <Route path="/dashboard/residents"   element={<FaceDatabasePage />} />
      </Routes>
    </Router>
  );
}
