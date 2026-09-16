import { describe, it, expect } from 'vitest';
import { visibleComments } from '../facebook-conversation-ui';
describe('fecha junto al botón de respuesta',()=>{
 it('lee la fecha debajo del comentario sin mezclarla con su texto',()=>{
  const xml='<node package="com.facebook.katana" class="android.widget.ImageView" content-desc="Foto de perfil de Ana" bounds="[33,843][143,953]" /><node package="com.facebook.katana" class="android.widget.Button" text="Ana" bounds="[154,838][394,899]" /><node package="com.facebook.katana" class="android.view.ViewGroup" text="¿Qué supermercado recomiendas?" bounds="[165,920][900,1030]" /><node package="com.facebook.katana" class="android.view.ViewGroup" text="2 d" bounds="[150,1050][230,1090]" /><node package="com.facebook.katana" class="android.widget.Button" text="Responder al comentario de Ana" bounds="[240,1050][600,1133]" />';
  expect(visibleComments(xml)[0]).toMatchObject({dateLabel:'2 d',text:'¿Qué supermercado recomiendas?'});
 });
});
