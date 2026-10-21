import { Route, Routes } from "react-router-dom";
import Login from "./pages/login/Login";


const Router = () => {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
    </Routes>
  );
};


export default Router;
