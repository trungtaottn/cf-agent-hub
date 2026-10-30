import {test,expect,appOrigin} from '../helpers/browser';
import {login,fixtureControl} from '../helpers/ui';

test.beforeEach(async({page})=>{await page.goto(appOrigin+'/health/live');await fixtureControl(page,'fresh');});

test('duplicate catalog labels remain advisory and the previewed profile persists through real HTTP',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByText('Edit complete portable profile').click();
 const editor=page.getByLabel('Portable profile JSON',{exact:true});
 const draft=JSON.parse(await editor.inputValue());
 const project=(id:string)=>({id,display_name:'Shared label',description:'Synthetic UI regression',archived:false});
 draft.projects=[project('project_duplicate_a'),project('project_duplicate_b')];
 await editor.fill(JSON.stringify(draft));
 await page.getByRole('button',{name:'Preview profile',exact:true}).click();
 await expect(page.getByTestId('profile-result')).toContainText('Preview complete');
 await expect(page.getByTestId('profile-preview')).toContainText('DUPLICATE_NAME');
 const apply=page.getByRole('button',{name:'Apply previewed profile',exact:true});
 await expect(apply).toBeEnabled();await apply.click();
 await expect(page.getByTestId('profile-result')).toContainText('Profile saved');
 await expect(apply).toBeDisabled();
 await page.reload();await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByText('Edit complete portable profile').click();
 const stored=JSON.parse(await page.getByLabel('Portable profile JSON',{exact:true}).inputValue());
 expect(stored.projects).toEqual(draft.projects);
});

test('archive conflict remains blocking even when the same preview also has an advisory duplicate label',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByText('Edit complete portable profile').click();
 const editor=page.getByLabel('Portable profile JSON',{exact:true});
 const draft=JSON.parse(await editor.inputValue()),original=structuredClone(draft.projects);
 draft.projects=[{id:'project_archive_attempt',display_name:'Shared label',description:'',archived:true},{id:'project_advisory',display_name:'Shared label',description:'',archived:false}];
 let writes=0;
 await page.route('**/v2/workspaces/ws_example/profile',async route=>{if(route.request().method()==='PUT')++writes;await route.continue();});
 await editor.fill(JSON.stringify(draft));await page.getByRole('button',{name:'Preview profile',exact:true}).click();
 await expect(page.getByTestId('profile-result')).toContainText('Preview complete');
 await expect(page.getByTestId('profile-preview')).toContainText('REFERENCED_ARCHIVE');
 await expect(page.getByTestId('profile-preview')).toContainText('DUPLICATE_NAME');
 await expect(page.getByRole('button',{name:'Apply previewed profile',exact:true})).toBeDisabled();
 expect(writes).toBe(0);
 await page.reload();await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByText('Edit complete portable profile').click();
 expect(JSON.parse(await page.getByLabel('Portable profile JSON',{exact:true}).inputValue()).projects).toEqual(original);
});
