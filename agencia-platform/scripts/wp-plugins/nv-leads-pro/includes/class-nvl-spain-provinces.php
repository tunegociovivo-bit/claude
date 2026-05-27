<?php
/**
 * Lista de provincias españolas con su capital y coordenadas aproximadas.
 * Se utiliza para descomponer una búsqueda "Toda España" en queries más pequeñas
 * y respetar el tope de ~60 resultados por Text Search de Places API.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Spain_Provinces {

    /**
     * @return array<int, array{name:string, capital:string, lat:float, lng:float, ccaa:string}>
     */
    public static function all() {
        return array(
            array( 'name' => 'A Coruña',          'capital' => 'A Coruña',          'lat' => 43.3623, 'lng' => -8.4115, 'ccaa' => 'Galicia' ),
            array( 'name' => 'Álava',             'capital' => 'Vitoria-Gasteiz',   'lat' => 42.8467, 'lng' => -2.6716, 'ccaa' => 'País Vasco' ),
            array( 'name' => 'Albacete',          'capital' => 'Albacete',          'lat' => 38.9943, 'lng' => -1.8585, 'ccaa' => 'Castilla-La Mancha' ),
            array( 'name' => 'Alicante',          'capital' => 'Alicante',          'lat' => 38.3452, 'lng' => -0.4810, 'ccaa' => 'Comunidad Valenciana' ),
            array( 'name' => 'Almería',           'capital' => 'Almería',           'lat' => 36.8340, 'lng' => -2.4637, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Asturias',          'capital' => 'Oviedo',            'lat' => 43.3614, 'lng' => -5.8593, 'ccaa' => 'Asturias' ),
            array( 'name' => 'Ávila',             'capital' => 'Ávila',             'lat' => 40.6566, 'lng' => -4.6818, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Badajoz',           'capital' => 'Badajoz',           'lat' => 38.8794, 'lng' => -6.9707, 'ccaa' => 'Extremadura' ),
            array( 'name' => 'Barcelona',         'capital' => 'Barcelona',         'lat' => 41.3851, 'lng' =>  2.1734, 'ccaa' => 'Cataluña' ),
            array( 'name' => 'Burgos',            'capital' => 'Burgos',            'lat' => 42.3439, 'lng' => -3.6969, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Cáceres',           'capital' => 'Cáceres',           'lat' => 39.4753, 'lng' => -6.3724, 'ccaa' => 'Extremadura' ),
            array( 'name' => 'Cádiz',             'capital' => 'Cádiz',             'lat' => 36.5298, 'lng' => -6.2924, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Cantabria',         'capital' => 'Santander',         'lat' => 43.4623, 'lng' => -3.8099, 'ccaa' => 'Cantabria' ),
            array( 'name' => 'Castellón',         'capital' => 'Castellón',         'lat' => 39.9864, 'lng' => -0.0513, 'ccaa' => 'Comunidad Valenciana' ),
            array( 'name' => 'Ceuta',             'capital' => 'Ceuta',             'lat' => 35.8894, 'lng' => -5.3198, 'ccaa' => 'Ceuta' ),
            array( 'name' => 'Ciudad Real',       'capital' => 'Ciudad Real',       'lat' => 38.9848, 'lng' => -3.9275, 'ccaa' => 'Castilla-La Mancha' ),
            array( 'name' => 'Córdoba',           'capital' => 'Córdoba',           'lat' => 37.8882, 'lng' => -4.7794, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Cuenca',            'capital' => 'Cuenca',            'lat' => 40.0703, 'lng' => -2.1374, 'ccaa' => 'Castilla-La Mancha' ),
            array( 'name' => 'Girona',            'capital' => 'Girona',            'lat' => 41.9794, 'lng' =>  2.8214, 'ccaa' => 'Cataluña' ),
            array( 'name' => 'Granada',           'capital' => 'Granada',           'lat' => 37.1773, 'lng' => -3.5986, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Guadalajara',       'capital' => 'Guadalajara',       'lat' => 40.6334, 'lng' => -3.1669, 'ccaa' => 'Castilla-La Mancha' ),
            array( 'name' => 'Guipúzcoa',         'capital' => 'San Sebastián',     'lat' => 43.3183, 'lng' => -1.9812, 'ccaa' => 'País Vasco' ),
            array( 'name' => 'Huelva',            'capital' => 'Huelva',            'lat' => 37.2614, 'lng' => -6.9447, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Huesca',            'capital' => 'Huesca',            'lat' => 42.1401, 'lng' => -0.4087, 'ccaa' => 'Aragón' ),
            array( 'name' => 'Islas Baleares',    'capital' => 'Palma',             'lat' => 39.5696, 'lng' =>  2.6502, 'ccaa' => 'Baleares' ),
            array( 'name' => 'Jaén',              'capital' => 'Jaén',              'lat' => 37.7796, 'lng' => -3.7849, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'La Rioja',          'capital' => 'Logroño',           'lat' => 42.4627, 'lng' => -2.4449, 'ccaa' => 'La Rioja' ),
            array( 'name' => 'Las Palmas',        'capital' => 'Las Palmas de GC',  'lat' => 28.1235, 'lng' => -15.4366,'ccaa' => 'Canarias' ),
            array( 'name' => 'León',              'capital' => 'León',              'lat' => 42.5987, 'lng' => -5.5671, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Lleida',            'capital' => 'Lleida',            'lat' => 41.6176, 'lng' =>  0.6200, 'ccaa' => 'Cataluña' ),
            array( 'name' => 'Lugo',              'capital' => 'Lugo',              'lat' => 43.0125, 'lng' => -7.5559, 'ccaa' => 'Galicia' ),
            array( 'name' => 'Madrid',            'capital' => 'Madrid',            'lat' => 40.4168, 'lng' => -3.7038, 'ccaa' => 'Madrid' ),
            array( 'name' => 'Málaga',            'capital' => 'Málaga',            'lat' => 36.7213, 'lng' => -4.4214, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Melilla',           'capital' => 'Melilla',           'lat' => 35.2923, 'lng' => -2.9381, 'ccaa' => 'Melilla' ),
            array( 'name' => 'Murcia',            'capital' => 'Murcia',            'lat' => 37.9922, 'lng' => -1.1307, 'ccaa' => 'Murcia' ),
            array( 'name' => 'Navarra',           'capital' => 'Pamplona',          'lat' => 42.8125, 'lng' => -1.6458, 'ccaa' => 'Navarra' ),
            array( 'name' => 'Ourense',           'capital' => 'Ourense',           'lat' => 42.3406, 'lng' => -7.8642, 'ccaa' => 'Galicia' ),
            array( 'name' => 'Palencia',          'capital' => 'Palencia',          'lat' => 42.0096, 'lng' => -4.5288, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Pontevedra',        'capital' => 'Pontevedra',        'lat' => 42.4310, 'lng' => -8.6444, 'ccaa' => 'Galicia' ),
            array( 'name' => 'Salamanca',         'capital' => 'Salamanca',         'lat' => 40.9701, 'lng' => -5.6635, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Santa Cruz de Tenerife','capital'=>'Santa Cruz de Tenerife','lat'=>28.4636,'lng'=>-16.2518,'ccaa'=>'Canarias' ),
            array( 'name' => 'Segovia',           'capital' => 'Segovia',           'lat' => 40.9429, 'lng' => -4.1088, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Sevilla',           'capital' => 'Sevilla',           'lat' => 37.3891, 'lng' => -5.9845, 'ccaa' => 'Andalucía' ),
            array( 'name' => 'Soria',             'capital' => 'Soria',             'lat' => 41.7665, 'lng' => -2.4790, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Tarragona',         'capital' => 'Tarragona',         'lat' => 41.1189, 'lng' =>  1.2445, 'ccaa' => 'Cataluña' ),
            array( 'name' => 'Teruel',            'capital' => 'Teruel',            'lat' => 40.3456, 'lng' => -1.1064, 'ccaa' => 'Aragón' ),
            array( 'name' => 'Toledo',            'capital' => 'Toledo',            'lat' => 39.8628, 'lng' => -4.0273, 'ccaa' => 'Castilla-La Mancha' ),
            array( 'name' => 'Valencia',          'capital' => 'Valencia',          'lat' => 39.4699, 'lng' => -0.3763, 'ccaa' => 'Comunidad Valenciana' ),
            array( 'name' => 'Valladolid',        'capital' => 'Valladolid',        'lat' => 41.6523, 'lng' => -4.7245, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Vizcaya',           'capital' => 'Bilbao',            'lat' => 43.2630, 'lng' => -2.9350, 'ccaa' => 'País Vasco' ),
            array( 'name' => 'Zamora',            'capital' => 'Zamora',            'lat' => 41.5033, 'lng' => -5.7446, 'ccaa' => 'Castilla y León' ),
            array( 'name' => 'Zaragoza',          'capital' => 'Zaragoza',          'lat' => 41.6488, 'lng' => -0.8891, 'ccaa' => 'Aragón' ),
        );
    }

    public static function names() {
        return array_map( function( $p ) { return $p['name']; }, self::all() );
    }

    public static function find( $name ) {
        $name_l = mb_strtolower( $name );
        foreach ( self::all() as $p ) {
            if ( mb_strtolower( $p['name'] ) === $name_l || mb_strtolower( $p['capital'] ) === $name_l ) {
                return $p;
            }
        }
        return null;
    }
}
