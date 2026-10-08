import {Tabs, TabsContent, TabsList, TabsTrigger} from './components/ui/tabs/index.js';
import {Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger} from './components/ui/sidebar/index.ts';
import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from './components/ui/empty/index.js';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from './components/ui/alert-dialog/index.js';
import {NativeSelect} from './components/ui/native-select/index.js';
import {Input} from './components/ui/input/index.ts';
import {Alert, AlertDescription, AlertTitle} from './components/ui/alert/index.js';
import {Skeleton} from './components/ui/skeleton/index.ts';
import {Separator} from './components/ui/separator/index.ts';
import {Checkbox} from './components/ui/checkbox/index.js';
import {Field, FieldDescription, FieldError, FieldGroup, FieldLabel} from './components/ui/field/index.js';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './components/ui/dialog/index.js';
import {InputGroup, InputGroupAddon, InputGroupInput} from './components/ui/input-group/index.ts';
import {Textarea} from './components/ui/textarea/index.ts';
import {Button} from './components/ui/button/index.ts';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './components/ui/table/index.js';
import {Switch} from './components/ui/switch/index.js';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from './components/ui/resizable/index.js';
import {Badge} from './components/ui/badge/index.js';
export function registerUI(app){
const components={Tabs, TabsContent, TabsList, TabsTrigger, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, NativeSelect, Input, Alert, AlertDescription, AlertTitle, Skeleton, Separator, Checkbox, Field, FieldDescription, FieldError, FieldGroup, FieldLabel, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, InputGroup, InputGroupAddon, InputGroupInput, Textarea, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Switch, ResizableHandle, ResizablePanel, ResizablePanelGroup, Badge};
for(const [name,value] of Object.entries(components)) app.component(name,value);

}
