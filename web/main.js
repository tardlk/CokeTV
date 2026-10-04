import {createApp} from 'vue';
import App from './App.vue';
import {registerUI} from './register-ui.js';
import './style.css';
const app=createApp(App);
registerUI(app);
app.mount('#app');
