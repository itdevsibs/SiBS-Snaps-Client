import { Route, Routes } from "react-router-dom";
import Login from "./page/login/Login";


const Router = () => {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
    </Routes>
  );
};


export default Router;
