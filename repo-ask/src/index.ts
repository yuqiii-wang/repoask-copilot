import { setupExtension, deactivate } from './extension';

function activate(context: any) {
	return setupExtension(context);
}

export { 
	activate,
	deactivate
};
